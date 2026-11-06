#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod storage;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const CLOSE_TIMEOUT_SECS: u64 = 12;

static ALLOW_CLOSE: AtomicBool = AtomicBool::new(false);
static CLOSE_PENDING: AtomicBool = AtomicBool::new(false);
static CLOSE_TOKEN: AtomicU64 = AtomicU64::new(0);

fn app_paths(app: &tauri::AppHandle) -> Result<storage::AppPaths, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录：{}", err))?;
    Ok(storage::AppPaths::new(dir))
}

#[tauri::command]
async fn load_store(app: tauri::AppHandle) -> Result<storage::LoadResult, String> {
    let paths = app_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::load(&paths))
        .await
        .map_err(|err| format!("读取项目库线程失败：{}", err))?
}

#[tauri::command]
async fn save_store(
    app: tauri::AppHandle,
    json: String,
) -> Result<storage::SaveResult, String> {
    let paths = app_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::save(&paths, &json))
        .await
        .map_err(|err| format!("保存项目库线程失败：{}", err))?
}

#[tauri::command]
async fn backup_store(
    app: tauri::AppHandle,
    reason: String,
) -> Result<storage::BackupResult, String> {
    let paths = app_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || storage::force_backup(&paths, &reason))
        .await
        .map_err(|err| format!("写入备份线程失败：{}", err))?
}

#[tauri::command]
async fn export_json(
    app: tauri::AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let paths = app_paths(&app)?;
    let file_name = storage::sanitize_file_name(&default_name);
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("导出 JSON")
            .set_file_name(file_name)
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|err| format!("打开导出对话框失败：{}", err))?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let mut path = file_path
        .into_path()
        .map_err(|err| format!("无法解析保存路径：{}", err))?;
    if path.extension().is_none() {
        path.set_extension("json");
    }
    if storage::same_file_target(&path, &paths.store_path) {
        return Err("不能把导出文件覆盖到项目库 store.json。".to_string());
    }
    let path_string = path.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        storage::atomic_write(&path, content.as_bytes())
    })
    .await
    .map_err(|err| format!("导出写入线程失败：{}", err))??;
    Ok(Some(path_string))
}

#[tauri::command]
async fn import_json(app: tauri::AppHandle) -> Result<Option<storage::ImportResult>, String> {
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("导入 JSON")
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| format!("打开导入对话框失败：{}", err))?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|err| format!("无法解析所选文件路径：{}", err))?;
    let result = tauri::async_runtime::spawn_blocking(move || storage::read_import(&path))
        .await
        .map_err(|err| format!("读取导入文件线程失败：{}", err))??;
    Ok(Some(result))
}

#[tauri::command]
fn get_paths(app: tauri::AppHandle) -> Result<storage::PathsInfo, String> {
    Ok(app_paths(&app)?.info())
}

#[tauri::command]
fn open_backup_dir(app: tauri::AppHandle) -> Result<String, String> {
    let paths = app_paths(&app)?;
    std::fs::create_dir_all(&paths.backup_dir)
        .map_err(|err| format!("创建备份目录失败：{}", err))?;
    let shown = paths.backup_dir.to_string_lossy().into_owned();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&paths.backup_dir)
            .spawn()
            .map_err(|err| format!("打开资源管理器失败：{}", err))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(&paths.backup_dir)
            .spawn()
            .map_err(|err| format!("打开备份目录失败：{}", err))?;
    }
    Ok(shown)
}

#[tauri::command]
fn confirm_close(app: tauri::AppHandle) -> Result<(), String> {
    CLOSE_PENDING.store(false, Ordering::SeqCst);
    CLOSE_TOKEN.fetch_add(1, Ordering::SeqCst);
    ALLOW_CLOSE.store(true, Ordering::SeqCst);

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在。".to_string())?;
    if let Err(err) = window.close() {
        ALLOW_CLOSE.store(false, Ordering::SeqCst);
        return Err(format!("关闭窗口失败：{}", err));
    }
    Ok(())
}

#[tauri::command]
fn cancel_close() {
    CLOSE_PENDING.store(false, Ordering::SeqCst);
    CLOSE_TOKEN.fetch_add(1, Ordering::SeqCst);
    ALLOW_CLOSE.store(false, Ordering::SeqCst);
}

fn install_close_handshake(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "main window missing"))?;
    let handle = app.handle().clone();

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if ALLOW_CLOSE.swap(false, Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if CLOSE_PENDING.swap(true, Ordering::SeqCst) {
                return;
            }

            let token = CLOSE_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = handle.emit("app://flush", ());
            let timeout_handle = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(CLOSE_TIMEOUT_SECS));
                if CLOSE_TOKEN.load(Ordering::SeqCst) == token
                    && CLOSE_PENDING.load(Ordering::SeqCst)
                {
                    // 前端没有在超时内回应（可能已卡死或尚未加载）：
                    // 兜底关闭，避免窗口永远关不掉。
                    CLOSE_PENDING.store(false, Ordering::SeqCst);
                    ALLOW_CLOSE.store(true, Ordering::SeqCst);
                    if let Some(window) = timeout_handle.get_webview_window("main") {
                        let _ = window.close();
                    }
                }
            });
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(agent::AgentState::default())
        .setup(|app| {
            install_close_handshake(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_store,
            save_store,
            backup_store,
            export_json,
            import_json,
            get_paths,
            open_backup_dir,
            confirm_close,
            cancel_close,
            agent::agent_store_load,
            agent::agent_store_save,
            agent::attachments::agent_attachment_index,
            agent::attachments::agent_attachment_read,
            agent::attachments::agent_attachment_put,
            agent::attachments::agent_attachment_prune,
            agent::attachments::agent_attachment_clear,
            agent::credentials::agent_key_has,
            agent::credentials::agent_key_set,
            agent::credentials::agent_key_clear,
            agent::llm::agent_stream,
            agent::llm::agent_cancel,
            agent::llm::agent_complete,
            agent::llm::agent_list_models,
            agent::llm::agent_open_url,
            agent::search::agent_web_search
        ])
        .run(tauri::generate_context!())
        .expect("error while running survey-jujin");
}
