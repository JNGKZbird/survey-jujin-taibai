//! 图片附件落盘：索引、读取、写入、保守清理。
//!
//! 目录固定为 `app_data_dir/attachments`，文件名为 `<id>.<jpg|png|webp>`。
//! 只保存压缩后的发送图，不保存相机原图、路径或 base64；`agent.json` 里仍然
//! 只有白名单元数据。清理时先读原始 JSON，坏库/未来版本整次跳过，绝不按空集合误删。

use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::Value;

use super::store::MAX_AGENT_BYTES;

pub const MAX_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
pub const TEMP_GRACE: Duration = Duration::from_secs(10 * 60);

const MAX_STORE_DEPTH: usize = 64;
const MAX_STORE_NODES: usize = 200_000;

static ATTACHMENT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutResult {
    pub id: String,
    pub bytes: u64,
    pub ext: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub found: bool,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResult {
    pub dir: String,
    pub ids: Vec<String>,
    pub count: u64,
    pub bytes: u64,
    pub max_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub removed: u64,
    pub removed_bytes: u64,
    pub kept: u64,
    pub skipped: bool,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearResult {
    pub removed: u64,
    pub removed_bytes: u64,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone)]
struct ScanEntry {
    path: PathBuf,
    id: Option<String>,
    bytes: u64,
    modified: Option<SystemTime>,
    is_temp: bool,
}

fn lock_attachment() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    ATTACHMENT_LOCK
        .lock()
        .map_err(|_| "attachment_lock".to_string())
}

fn reserved_id(id: &str) -> bool {
    matches!(id, "con" | "prn" | "aux" | "nul")
        || (id.len() == 4
            && (id.starts_with("com") || id.starts_with("lpt"))
            && matches!(id.as_bytes()[3], b'1'..=b'9'))
}

fn id_error(id: &str) -> Option<&'static str> {
    if id.is_empty() || id.len() > 64 {
        return Some("attachment_invalid_id");
    }
    let valid = id.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
    });
    if !valid {
        return Some("attachment_invalid_id");
    }
    if reserved_id(id) {
        return Some("attachment_reserved_id");
    }
    None
}

fn valid_id(id: &str) -> bool {
    id_error(id).is_none()
}

fn ext_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn mime_for_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "jpg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn magic_matches(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/jpeg" => bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
        "image/png" => {
            bytes.len() >= 8
                && bytes[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        }
        "image/webp" => {
            bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        _ => false,
    }
}

fn max_encoded_chars() -> usize {
    // 2 MiB 的 base64 编码长度上界；先按字符串长度挡掉巨量输入，再解码。
    ((MAX_ATTACHMENT_BYTES as usize + 2) / 3) * 4 + 4
}

fn decode_data_url(data_url: &str) -> Result<(&'static str, Vec<u8>), String> {
    let (mime, payload) = if let Some(rest) = data_url.strip_prefix("data:image/jpeg;base64,") {
        ("image/jpeg", rest)
    } else if let Some(rest) = data_url.strip_prefix("data:image/png;base64,") {
        ("image/png", rest)
    } else if let Some(rest) = data_url.strip_prefix("data:image/webp;base64,") {
        ("image/webp", rest)
    } else {
        return Err("attachment_invalid_data_url".to_string());
    };
    if payload.is_empty() {
        return Err("attachment_invalid_data_url".to_string());
    }
    if payload.len() > max_encoded_chars() {
        return Err("attachment_too_large".to_string());
    }
    let base64_ok = payload.bytes().all(|byte| {
        matches!(byte,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/' | b'=')
    });
    if !base64_ok {
        return Err("attachment_invalid_data_url".to_string());
    }
    let bytes = BASE64
        .decode(payload)
        .map_err(|_| "attachment_invalid_data_url".to_string())?;
    if bytes.is_empty() {
        return Err("attachment_invalid_data_url".to_string());
    }
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("attachment_too_large".to_string());
    }
    if !magic_matches(mime, &bytes) {
        return Err("attachment_mime_mismatch".to_string());
    }
    Ok((mime, bytes))
}

fn dir_state(dir: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(dir) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                Err("attachment_symlink".to_string())
            } else if !meta.is_dir() {
                Err("attachment_not_dir".to_string())
            } else {
                Ok(true)
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("attachment_io".to_string()),
    }
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    match dir_state(dir)? {
        true => Ok(()),
        false => {
            fs::create_dir_all(dir).map_err(|_| "attachment_io".to_string())?;
            match dir_state(dir)? {
                true => Ok(()),
                false => Err("attachment_io".to_string()),
            }
        }
    }
}

fn parse_attachment_name(name: &str) -> Option<(String, &'static str)> {
    let (id, ext) = name.rsplit_once('.')?;
    if !valid_id(id) {
        return None;
    }
    let ext = match ext {
        "jpg" => "jpg",
        "png" => "png",
        "webp" => "webp",
        _ => return None,
    };
    Some((id.to_string(), ext))
}

fn is_temp_name(name: &str) -> bool {
    name.starts_with(".tmp-") || (name.starts_with('.') && name.contains(".tmp-"))
}

fn scan_dir(dir: &Path) -> Result<Vec<ScanEntry>, String> {
    if !dir_state(dir)? {
        return Ok(Vec::new());
    }
    let read = fs::read_dir(dir).map_err(|_| "attachment_io".to_string())?;
    let mut out = Vec::new();
    for item in read {
        let item = item.map_err(|_| "attachment_io".to_string())?;
        let file_type = item.file_type().map_err(|_| "attachment_io".to_string())?;
        if !file_type.is_file() {
            // 符号链接、目录、reparse point 一律不跟。
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let parsed = parse_attachment_name(&name);
        let temp = is_temp_name(&name);
        if parsed.is_none() && !temp {
            continue;
        }
        let metadata = item.metadata().map_err(|_| "attachment_io".to_string())?;
        out.push(ScanEntry {
            path: item.path(),
            id: parsed.map(|(id, _)| id),
            bytes: metadata.len(),
            modified: metadata.modified().ok(),
            is_temp: temp,
        });
    }
    Ok(out)
}

fn dir_usage(dir: &Path) -> Result<(u64, u64), String> {
    let mut bytes = 0u64;
    let mut count = 0u64;
    for entry in scan_dir(dir)? {
        if entry.id.is_some() {
            bytes = bytes.saturating_add(entry.bytes);
            count += 1;
        }
    }
    Ok((bytes, count))
}

fn skip_prune(reason: &str) -> PruneResult {
    PruneResult {
        removed: 0,
        removed_bytes: 0,
        kept: 0,
        skipped: true,
        reason: reason.to_string(),
    }
}

pub fn put(dir: &Path, id: &str, data_url: &str, max_total: u64) -> Result<PutResult, String> {
    let _guard = lock_attachment()?;
    if let Some(code) = id_error(id) {
        return Err(code.to_string());
    }
    let (mime, bytes) = decode_data_url(data_url)?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("attachment_too_large".to_string());
    }
    let ext = ext_for_mime(mime).ok_or_else(|| "attachment_unsupported_mime".to_string())?;
    ensure_dir(dir)?;

    let target = dir.join(format!("{id}.{ext}"));
    if let Ok(meta) = fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() {
            return Err("attachment_symlink".to_string());
        }
        if !meta.is_file() {
            return Err("attachment_not_file".to_string());
        }
    }

    let (total_bytes, _) = dir_usage(dir)?;
    let mut replaced = 0u64;
    for entry in scan_dir(dir)? {
        if entry.id.as_deref() == Some(id) {
            replaced = replaced.saturating_add(entry.bytes);
        }
    }
    let next_total = total_bytes
        .saturating_sub(replaced)
        .saturating_add(bytes.len() as u64);
    if next_total > max_total {
        return Err("attachment_quota".to_string());
    }

    crate::storage::atomic_write(&target, &bytes).map_err(|_| "attachment_io".to_string())?;

    // 同一个 id 只保留一种扩展名，避免读盘时优先级掩盖旧图。
    for other in ["jpg", "png", "webp"] {
        if other == ext {
            continue;
        }
        let path = dir.join(format!("{id}.{other}"));
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.is_file() && !meta.file_type().is_symlink() {
                let _ = fs::remove_file(&path);
            }
        }
    }

    Ok(PutResult {
        id: id.to_string(),
        bytes: bytes.len() as u64,
        ext: ext.to_string(),
        path: target.to_string_lossy().into_owned(),
    })
}

pub fn read(dir: &Path, id: &str) -> Result<ReadResult, String> {
    let _guard = lock_attachment()?;
    if let Some(code) = id_error(id) {
        return Err(code.to_string());
    }
    if !dir_state(dir)? {
        return Ok(ReadResult {
            found: false,
            id: id.to_string(),
            mime: None,
            bytes: None,
            data_url: None,
        });
    }
    for ext in ["jpg", "png", "webp"] {
        let path = dir.join(format!("{id}.{ext}"));
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("attachment_io".to_string()),
        };
        if metadata.file_type().is_symlink() {
            return Err("attachment_symlink".to_string());
        }
        if !metadata.is_file() {
            return Err("attachment_not_file".to_string());
        }
        if metadata.len() > MAX_ATTACHMENT_BYTES {
            return Err("attachment_too_large".to_string());
        }
        let bytes = fs::read(&path).map_err(|_| "attachment_io".to_string())?;
        let mime = mime_for_ext(ext).ok_or_else(|| "attachment_unsupported_mime".to_string())?;
        if !magic_matches(mime, &bytes) {
            return Err("attachment_mime_mismatch".to_string());
        }
        return Ok(ReadResult {
            found: true,
            id: id.to_string(),
            mime: Some(mime.to_string()),
            bytes: Some(bytes.len() as u64),
            data_url: Some(format!("data:{};base64,{}", mime, BASE64.encode(&bytes))),
        });
    }
    Ok(ReadResult {
        found: false,
        id: id.to_string(),
        mime: None,
        bytes: None,
        data_url: None,
    })
}

pub fn index(dir: &Path, max_bytes: u64) -> Result<IndexResult, String> {
    let _guard = lock_attachment()?;
    let mut ids = BTreeSet::new();
    let mut bytes = 0u64;
    for entry in scan_dir(dir)? {
        if let Some(id) = entry.id {
            ids.insert(id);
            bytes = bytes.saturating_add(entry.bytes);
        }
    }
    let cap = if max_bytes == 0 { MAX_TOTAL_BYTES } else { max_bytes };
    Ok(IndexResult {
        dir: dir.to_string_lossy().into_owned(),
        count: ids.len() as u64,
        ids: ids.into_iter().collect(),
        bytes,
        max_bytes: cap,
    })
}

fn read_store_value(path: &Path) -> Result<Value, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err("agent_store_missing".to_string())
        }
        Err(_) => return Err("agent_store_unreadable".to_string()),
    };
    if bytes.len() as u64 > MAX_AGENT_BYTES {
        return Err("agent_store_too_large".to_string());
    }
    let text = String::from_utf8(bytes).map_err(|_| "agent_store_invalid".to_string())?;
    let value: Value =
        serde_json::from_str(&text).map_err(|_| "agent_store_invalid".to_string())?;
    if !value.is_object() {
        return Err("agent_store_invalid".to_string());
    }
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("agent_store_version".to_string());
    }
    Ok(value)
}

fn read_backup_value(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|_| "agent_backup_unreadable".to_string())?;
    if bytes.len() as u64 > MAX_AGENT_BYTES {
        return Err("agent_backup_unreadable".to_string());
    }
    let text = String::from_utf8(bytes).map_err(|_| "agent_backup_invalid".to_string())?;
    let value: Value =
        serde_json::from_str(&text).map_err(|_| "agent_backup_invalid".to_string())?;
    if !value.is_object() {
        return Err("agent_backup_invalid".to_string());
    }
    if value.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("agent_backup_version".to_string());
    }
    Ok(value)
}

fn collect_refs(
    value: &Value,
    ids: &mut HashSet<String>,
    depth: usize,
    budget: &mut usize,
) -> Result<(), String> {
    if depth > MAX_STORE_DEPTH || *budget == 0 {
        return Err("agent_store_too_large".to_string());
    }
    *budget -= 1;
    match value {
        Value::Object(map) => {
            if map.get("kind").and_then(Value::as_str) == Some("image") {
                if let Some(id) = map.get("id").and_then(Value::as_str) {
                    if valid_id(id) {
                        ids.insert(id.to_string());
                    }
                }
            }
            for child in map.values() {
                collect_refs(child, ids, depth + 1, budget)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_refs(child, ids, depth + 1, budget)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn collect_from_store(value: &Value, ids: &mut HashSet<String>) -> Result<(), String> {
    let mut budget = MAX_STORE_NODES;
    collect_refs(value, ids, 0, &mut budget)
}

/// 保守清理：只有 `agent.json` 与可读的 `.bak` 都是合法 version 1 时才动文件。
/// 任何不确定都返回 `skipped:true`，不删除任何东西。
pub fn prune(
    dir: &Path,
    agent_path: &Path,
    backup_path: &Path,
    now: SystemTime,
    temp_age: Duration,
) -> PruneResult {
    let _guard = match lock_attachment() {
        Ok(guard) => guard,
        Err(reason) => return skip_prune(&reason),
    };
    let agent = match read_store_value(agent_path) {
        Ok(value) => value,
        Err(reason) => return skip_prune(&reason),
    };
    let backup = if backup_path.exists() {
        match read_backup_value(backup_path) {
            Ok(value) => Some(value),
            Err(reason) => return skip_prune(&reason),
        }
    } else {
        None
    };
    let mut refs = HashSet::new();
    if let Err(reason) = collect_from_store(&agent, &mut refs) {
        return skip_prune(&reason);
    }
    if let Some(value) = backup {
        if let Err(reason) = collect_from_store(&value, &mut refs) {
            return skip_prune(&reason);
        }
    }
    let entries = match scan_dir(dir) {
        Ok(entries) => entries,
        Err(reason) => return skip_prune(&reason),
    };
    let mut removed = 0u64;
    let mut removed_bytes = 0u64;
    let mut kept = 0u64;
    for entry in entries {
        if let Some(id) = entry.id {
            if refs.contains(&id) {
                kept += 1;
                continue;
            }
            match fs::remove_file(&entry.path) {
                Ok(()) => {
                    removed += 1;
                    removed_bytes = removed_bytes.saturating_add(entry.bytes);
                }
                Err(_) => {}
            }
            continue;
        }
        if !entry.is_temp {
            continue;
        }
        let old = entry
            .modified
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age >= temp_age)
            .unwrap_or(false);
        if !old {
            continue;
        }
        if fs::remove_file(&entry.path).is_ok() {
            removed += 1;
            removed_bytes = removed_bytes.saturating_add(entry.bytes);
        }
    }
    PruneResult {
        removed,
        removed_bytes,
        kept,
        skipped: false,
        reason: String::new(),
    }
}

pub fn clear(dir: &Path) -> Result<ClearResult, String> {
    let _guard = lock_attachment()?;
    let entries = scan_dir(dir)?;
    let mut removed = 0u64;
    let mut removed_bytes = 0u64;
    let mut failed = Vec::new();
    for entry in entries {
        if entry.id.is_none() && !entry.is_temp {
            continue;
        }
        match fs::remove_file(&entry.path) {
            Ok(()) => {
                removed += 1;
                removed_bytes = removed_bytes.saturating_add(entry.bytes);
            }
            Err(err) => failed.push(format!("{}: {}", entry.path.to_string_lossy(), err)),
        }
    }
    Ok(ClearResult {
        removed,
        removed_bytes,
        failed,
    })
}

/* ------------------------------------------------------------------------- *
 * Tauri 命令
 * ------------------------------------------------------------------------- */

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("attachment_dir: {}", err))?;
    fs::create_dir_all(&dir).map_err(|err| format!("attachment_io: {}", err))?;
    Ok(dir)
}

fn attachments_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app_data_dir(app)?;
    let root_canon = fs::canonicalize(&root).map_err(|err| format!("attachment_io: {}", err))?;
    let dir = root.join("attachments");
    match fs::symlink_metadata(&dir) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err("attachment_symlink".to_string());
            }
            if !meta.is_dir() {
                return Err("attachment_not_dir".to_string());
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("attachment_io: {}", err)),
    }
    fs::create_dir_all(&dir).map_err(|err| format!("attachment_io: {}", err))?;
    let dir_canon = fs::canonicalize(&dir).map_err(|err| format!("attachment_io: {}", err))?;
    if dir_canon.parent() != Some(root_canon.as_path()) {
        return Err("attachment_dir".to_string());
    }
    Ok(dir)
}

#[tauri::command]
pub async fn agent_attachment_index(
    app: tauri::AppHandle,
) -> Result<IndexResult, String> {
    let dir = attachments_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || index(&dir, MAX_TOTAL_BYTES))
        .await
        .map_err(|err| format!("读取附件索引线程失败：{}", err))?
}

#[tauri::command]
pub async fn agent_attachment_read(
    app: tauri::AppHandle,
    id: String,
) -> Result<ReadResult, String> {
    let dir = attachments_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || read(&dir, &id))
        .await
        .map_err(|err| format!("读取附件线程失败：{}", err))?
}

#[tauri::command]
pub async fn agent_attachment_put(
    app: tauri::AppHandle,
    id: String,
    data_url: String,
) -> Result<PutResult, String> {
    let dir = attachments_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        put(&dir, &id, &data_url, MAX_TOTAL_BYTES)
    })
    .await
    .map_err(|err| format!("写入附件线程失败：{}", err))?
}

#[tauri::command]
pub async fn agent_attachment_prune(app: tauri::AppHandle) -> Result<PruneResult, String> {
    let dir = attachments_dir(&app)?;
    let root = app_data_dir(&app)?;
    let paths = super::store::AgentPaths::new(root);
    tauri::async_runtime::spawn_blocking(move || {
        prune(
            &dir,
            &paths.agent_path,
            &paths.backup_path,
            SystemTime::now(),
            TEMP_GRACE,
        )
    })
    .await
    .map_err(|err| format!("清理附件线程失败：{}", err))
}

#[tauri::command]
pub async fn agent_attachment_clear(app: tauri::AppHandle) -> Result<ClearResult, String> {
    let dir = attachments_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || clear(&dir))
        .await
        .map_err(|err| format!("清空附件线程失败：{}", err))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const JPEG: &[u8] = &[0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
    const PNG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const WEBP: &[u8] = b"RIFF\x24\x00\x00\x00WEBPVP8 ";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "survey-jujin-attachments-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn data_url(mime: &str, bytes: &[u8]) -> String {
        format!("data:{};base64,{}", mime, BASE64.encode(bytes))
    }

    fn write_file(path: &Path, bytes: &[u8]) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    fn write_json(path: &Path, text: &str) {
        fs::write(path, text).unwrap();
    }

    #[test]
    fn round_trips_all_three_formats() {
        let dir = temp_dir("roundtrip");
        let jpeg = data_url("image/jpeg", JPEG);
        let png = data_url("image/png", PNG);
        let webp = data_url("image/webp", WEBP);

        let put_jpeg = put(&dir, "img_jpeg", &jpeg, MAX_TOTAL_BYTES).unwrap();
        assert_eq!(put_jpeg.ext, "jpg");
        assert_eq!(put_jpeg.bytes, JPEG.len() as u64);
        assert!(dir.join("img_jpeg.jpg").is_file());
        let read_jpeg = read(&dir, "img_jpeg").unwrap();
        assert!(read_jpeg.found);
        assert_eq!(read_jpeg.mime.as_deref(), Some("image/jpeg"));
        assert_eq!(read_jpeg.data_url.as_deref(), Some(jpeg.as_str()));

        put(&dir, "img_png", &png, MAX_TOTAL_BYTES).unwrap();
        assert_eq!(read(&dir, "img_png").unwrap().mime.as_deref(), Some("image/png"));

        put(&dir, "img_webp", &webp, MAX_TOTAL_BYTES).unwrap();
        let read_webp = read(&dir, "img_webp").unwrap();
        assert_eq!(read_webp.mime.as_deref(), Some("image/webp"));
        assert_eq!(read_webp.data_url.as_deref(), Some(webp.as_str()));

        let index = index(&dir, MAX_TOTAL_BYTES).unwrap();
        assert_eq!(index.count, 3);
        assert_eq!(index.ids, vec![
            "img_jpeg".to_string(),
            "img_png".to_string(),
            "img_webp".to_string()
        ]);
        assert_eq!(index.bytes, (JPEG.len() + PNG.len() + WEBP.len()) as u64);
    }

    #[test]
    fn rejects_invalid_ids_and_reserved_names() {
        let dir = temp_dir("ids");
        let url = data_url("image/jpeg", JPEG);
        for id in ["", "IMG_A", "img.a", "img/a", "img a", &"a".repeat(65)] {
            assert_eq!(put(&dir, id, &url, MAX_TOTAL_BYTES).unwrap_err(),
                "attachment_invalid_id", "id={id}");
        }
        for id in ["con", "prn", "aux", "nul", "com1", "lpt9"] {
            assert_eq!(put(&dir, id, &url, MAX_TOTAL_BYTES).unwrap_err(),
                "attachment_reserved_id", "id={id}");
        }
        assert!(read(&dir, "IMG_A").is_err());
    }

    #[test]
    fn rejects_bad_data_urls_and_mismatched_magic() {
        let dir = temp_dir("dataurl");
        assert_eq!(
            put(&dir, "img_a", "data:image/gif;base64,R0lGODlh", MAX_TOTAL_BYTES).unwrap_err(),
            "attachment_invalid_data_url"
        );
        assert_eq!(
            put(&dir, "img_a", "data:image/jpeg;base64,QU JD", MAX_TOTAL_BYTES).unwrap_err(),
            "attachment_invalid_data_url"
        );
        assert_eq!(
            put(&dir, "img_a", "data:image/png;base64,", MAX_TOTAL_BYTES).unwrap_err(),
            "attachment_invalid_data_url"
        );
        assert_eq!(
            put(&dir, "img_a", &data_url("image/png", JPEG), MAX_TOTAL_BYTES).unwrap_err(),
            "attachment_mime_mismatch"
        );
    }

    #[test]
    fn rejects_images_over_two_mebibytes() {
        let dir = temp_dir("large");
        let big = vec![0u8; MAX_ATTACHMENT_BYTES as usize + 1];
        let url = format!("data:image/png;base64,{}", BASE64.encode(&big));
        assert_eq!(put(&dir, "img_big", &url, MAX_TOTAL_BYTES).unwrap_err(),
            "attachment_too_large");
        assert!(!dir.join("img_big.png").exists());
    }

    #[test]
    fn enforces_total_quota_and_replaces_same_id() {
        let dir = temp_dir("quota");
        put(&dir, "img_a", &data_url("image/jpeg", JPEG), 20).unwrap();
        put(&dir, "img_b", &data_url("image/png", PNG), 20).unwrap();
        assert_eq!(
            put(&dir, "img_c", &data_url("image/webp", WEBP), 20).unwrap_err(),
            "attachment_quota"
        );

        let dir2 = temp_dir("replace");
        put(&dir2, "img_a", &data_url("image/jpeg", JPEG), 20).unwrap();
        put(&dir2, "img_a", &data_url("image/png", PNG), 20).unwrap();
        assert!(!dir2.join("img_a.jpg").exists(), "替换后应清掉旧扩展名");
        assert!(dir2.join("img_a.png").is_file());
        let index = index(&dir2, 20).unwrap();
        assert_eq!(index.count, 1);
        assert_eq!(index.bytes, PNG.len() as u64);
    }

    #[test]
    fn index_ignores_unknown_files_temp_files_and_directories() {
        let dir = temp_dir("index-filter");
        write_file(&dir.join("img_keep.jpg"), JPEG);
        write_file(&dir.join("note.txt"), b"hello");
        write_file(&dir.join(".img_keep.jpg.tmp-1"), JPEG);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::create_dir_all(dir.join("img_dir.jpg")).unwrap();
        let result = index(&dir, MAX_TOTAL_BYTES).unwrap();
        assert_eq!(result.ids, vec!["img_keep".to_string()]);
        assert_eq!(result.count, 1);
        assert_eq!(result.bytes, JPEG.len() as u64);
    }

    #[test]
    fn read_reports_missing_and_non_file_candidates() {
        let dir = temp_dir("read-missing");
        let missing = read(&dir, "img_missing").unwrap();
        assert!(!missing.found);
        assert!(missing.data_url.is_none());

        fs::create_dir_all(dir.join("img_dir.jpg")).unwrap();
        assert_eq!(read(&dir, "img_dir").unwrap_err(), "attachment_not_file");
    }

    #[test]
    fn prune_keeps_references_from_store_and_backup() {
        let dir = temp_dir("prune-keep");
        write_file(&dir.join("img_keep.jpg"), JPEG);
        write_file(&dir.join("img_bak.png"), PNG);
        write_file(&dir.join("img_drop.webp"), WEBP);
        write_file(&dir.join("unknown.txt"), b"keep me");
        let old_temp = dir.join(".img_keep.jpg.tmp-1");
        write_file(&old_temp, JPEG);
        let agent = dir.join("agent.json");
        let backup = dir.join("agent.json.bak");
        write_json(&agent, r#"{"version":1,"workspaces":{"p":{"sessions":[{"nodes":[{"user":{"attachments":[{"kind":"image","id":"img_keep"}]}}]}]}}}"#);
        write_json(&backup, r#"{"version":1,"workspaces":{"p":{"sessions":[{"nodes":[{"user":{"attachments":[{"kind":"image","id":"img_bak"}]}}]}]}}}"#);

        let result = prune(
            &dir,
            &agent,
            &backup,
            SystemTime::now() + Duration::from_secs(3600),
            Duration::from_secs(600),
        );
        assert!(!result.skipped, "{}", result.reason);
        assert_eq!(result.removed, 2);
        assert_eq!(result.removed_bytes, (WEBP.len() + JPEG.len()) as u64);
        assert_eq!(result.kept, 2);
        assert!(dir.join("img_keep.jpg").is_file());
        assert!(dir.join("img_bak.png").is_file());
        assert!(!dir.join("img_drop.webp").exists());
        assert!(!old_temp.exists());
        assert!(dir.join("unknown.txt").is_file());
    }

    #[test]
    fn prune_skips_when_store_or_backup_is_not_trustworthy() {
        let dir = temp_dir("prune-skip");
        write_file(&dir.join("img_drop.jpg"), JPEG);
        let agent = dir.join("agent.json");
        let backup = dir.join("agent.json.bak");

        let missing = prune(&dir, &agent, &backup, SystemTime::now(), Duration::from_secs(0));
        assert!(missing.skipped);
        assert_eq!(missing.reason, "agent_store_missing");
        assert!(dir.join("img_drop.jpg").is_file());

        write_json(&agent, "not json");
        let invalid = prune(&dir, &agent, &backup, SystemTime::now(), Duration::from_secs(0));
        assert!(invalid.skipped);
        assert_eq!(invalid.reason, "agent_store_invalid");

        write_json(&agent, r#"{"version":2,"workspaces":{}}"#);
        let future = prune(&dir, &agent, &backup, SystemTime::now(), Duration::from_secs(0));
        assert!(future.skipped);
        assert_eq!(future.reason, "agent_store_version");

        write_json(&agent, r#"{"version":1,"workspaces":{}}"#);
        write_json(&backup, "not json");
        let bad_backup = prune(&dir, &agent, &backup, SystemTime::now(), Duration::from_secs(0));
        assert!(bad_backup.skipped);
        assert_eq!(bad_backup.reason, "agent_backup_invalid");
        assert!(dir.join("img_drop.jpg").is_file());
    }

    #[test]
    fn prune_leaves_fresh_temp_files_alone() {
        let dir = temp_dir("prune-fresh");
        let fresh = dir.join(".img_a.jpg.tmp-1");
        write_file(&fresh, JPEG);
        let agent = dir.join("agent.json");
        let backup = dir.join("agent.json.bak");
        write_json(&agent, r#"{"version":1,"workspaces":{}}"#);
        let now = SystemTime::now()
            .checked_sub(Duration::from_secs(60))
            .unwrap();
        let result = prune(&dir, &agent, &backup, now, Duration::from_secs(600));
        assert!(!result.skipped, "{}", result.reason);
        assert_eq!(result.removed, 0);
        assert!(fresh.is_file());
    }

    #[test]
    fn clear_removes_recognized_and_temp_but_not_unknown_files() {
        let dir = temp_dir("clear");
        write_file(&dir.join("img_a.jpg"), JPEG);
        write_file(&dir.join("img_b.png"), PNG);
        write_file(&dir.join(".img_a.jpg.tmp-1"), JPEG);
        write_file(&dir.join("notes.txt"), b"keep");
        fs::create_dir_all(dir.join("sub")).unwrap();
        let result = clear(&dir).unwrap();
        assert_eq!(result.removed, 3);
        assert!(result.failed.is_empty());
        assert!(!dir.join("img_a.jpg").exists());
        assert!(!dir.join("img_b.png").exists());
        assert!(!dir.join(".img_a.jpg.tmp-1").exists());
        assert!(dir.join("notes.txt").is_file());
        assert!(dir.join("sub").is_dir());
    }

    #[test]
    fn concurrent_puts_are_serialized() {
        let dir = temp_dir("concurrent");
        let mut handles = Vec::new();
        for index in 0..8 {
            let dir = dir.clone();
            handles.push(std::thread::spawn(move || {
                let id = format!("img_{}", index);
                put(&dir, &id, &data_url("image/jpeg", JPEG), MAX_TOTAL_BYTES)
            }));
        }
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
        let result = index(&dir, MAX_TOTAL_BYTES).unwrap();
        assert_eq!(result.count, 8);
        assert_eq!(result.bytes, (JPEG.len() * 8) as u64);
    }
}
