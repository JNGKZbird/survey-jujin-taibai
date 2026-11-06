//! AI 助手后端：对话库、凭据、模型请求。

pub mod attachments;
pub mod credentials;
pub mod llm;
pub mod search;
pub mod store;

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Manager;

#[derive(Default)]
pub struct AgentState {
    pub cancels: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

fn agent_paths(app: &tauri::AppHandle) -> Result<store::AgentPaths, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录：{}", err))?;
    Ok(store::AgentPaths::new(dir))
}

#[tauri::command]
pub async fn agent_store_load(
    app: tauri::AppHandle,
) -> Result<store::AgentLoadResult, String> {
    let paths = agent_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || store::load(&paths))
        .await
        .map_err(|err| format!("读取对话库线程失败：{}", err))
}

#[tauri::command]
pub async fn agent_store_save(
    app: tauri::AppHandle,
    json: String,
) -> Result<store::AgentSaveResult, String> {
    let paths = agent_paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || store::save(&paths, &json))
        .await
        .map_err(|err| format!("保存对话库线程失败：{}", err))?
}
