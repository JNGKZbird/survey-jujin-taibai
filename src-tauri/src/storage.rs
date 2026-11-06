// 本机项目库：原子写入、损坏隔离、自动备份。
//
// 这一层不依赖 Tauri，方便单元测试；路径由 main.rs 从 app_data_dir 推导后传进来。
// 备份策略：
//   - 内容未变（忽略 updatedAt）不写；
//   - 通常最多每 10 分钟一份；
//   - 每天首份必留；
//   - 破坏性操作前可强制写一份；
//   - 保留最近 20 份 + 最近 14 天每日首份 + 最近 14 天强制备份。

use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const SCHEMA_VERSION: u64 = 2;
pub const MAX_IMPORT_BYTES: u64 = 32 * 1024 * 1024;
const MIN_BACKUP_INTERVAL_SECS: i64 = 10 * 60;
const KEEP_RECENT: usize = 20;
const KEEP_DAILY_DAYS: i64 = 14;

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub app_data_dir: PathBuf,
    pub store_path: PathBuf,
    pub backup_dir: PathBuf,
}

impl AppPaths {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            store_path: app_data_dir.join("store.json"),
            backup_dir: app_data_dir.join("backups"),
            app_data_dir,
        }
    }

    pub fn info(&self) -> PathsInfo {
        PathsInfo {
            app_data_dir: display(&self.app_data_dir),
            store_path: display(&self.store_path),
            backup_dir: display(&self.backup_dir),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsInfo {
    pub app_data_dir: String,
    pub store_path: String,
    pub backup_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub text: Option<String>,
    pub corrupt: bool,
    pub future_version: Option<u64>,
    pub corrupt_path: Option<String>,
    pub app_data_dir: String,
    pub store_path: String,
    pub backup_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub bytes: usize,
    pub saved_at: String,
    pub backup_written: bool,
    pub backup_path: Option<String>,
    pub backup_error: Option<String>,
    pub store_path: String,
    pub backup_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub written: bool,
    pub path: Option<String>,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub path: String,
    pub name: String,
    pub size: usize,
    pub text: String,
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .lock()
        .map_err(|_| "本机存储锁已损坏，请重启软件。".to_string())
}

fn corrupt_result(paths: &AppPaths, reason: &str) -> Result<LoadResult, String> {
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut target = paths
        .app_data_dir
        .join(format!("store.corrupt-{}.json", stamp));
    let mut n = 2;
    while target.exists() {
        target = paths
            .app_data_dir
            .join(format!("store.corrupt-{}-{}.json", stamp, n));
        n += 1;
    }
    fs::create_dir_all(&paths.app_data_dir)
        .map_err(|err| format!("创建应用数据目录失败：{}", err))?;
    fs::rename(&paths.store_path, &target).map_err(|err| {
        format!(
            "项目库损坏（{}），且无法另存原文件：{}。请先备份 {}",
            reason,
            err,
            display(&paths.store_path)
        )
    })?;
    let info = paths.info();
    Ok(LoadResult {
        text: None,
        corrupt: true,
        future_version: None,
        corrupt_path: Some(display(&target)),
        app_data_dir: info.app_data_dir,
        store_path: info.store_path,
        backup_dir: info.backup_dir,
    })
}

pub fn load(paths: &AppPaths) -> Result<LoadResult, String> {
    let _guard = lock_store()?;
    let info = paths.info();

    if !paths.store_path.exists() {
        return Ok(LoadResult {
            text: None,
            corrupt: false,
            future_version: None,
            corrupt_path: None,
            app_data_dir: info.app_data_dir,
            store_path: info.store_path,
            backup_dir: info.backup_dir,
        });
    }

    let bytes = fs::read(&paths.store_path)
        .map_err(|err| format!("读取项目库失败：{}", err))?;
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return corrupt_result(paths, "文件不是 UTF-8"),
    };
    let value: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return corrupt_result(paths, "JSON 无法解析"),
    };

    let version = value.get("schemaVersion").and_then(Value::as_u64);
    if let Some(version) = version {
        if version > SCHEMA_VERSION {
            return Ok(LoadResult {
                text: None,
                corrupt: false,
                future_version: Some(version),
                corrupt_path: None,
                app_data_dir: info.app_data_dir,
                store_path: info.store_path,
                backup_dir: info.backup_dir,
            });
        }
    }
    if version != Some(SCHEMA_VERSION) {
        return corrupt_result(paths, "schemaVersion 不是 2");
    }

    let projects_ok = value
        .get("projects")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty() && items.iter().all(Value::is_object))
        .unwrap_or(false);
    if !projects_ok {
        return corrupt_result(paths, "projects 不是非空对象数组");
    }

    Ok(LoadResult {
        text: Some(text),
        corrupt: false,
        future_version: None,
        corrupt_path: None,
        app_data_dir: info.app_data_dir,
        store_path: info.store_path,
        backup_dir: info.backup_dir,
    })
}

pub fn save(paths: &AppPaths, json: &str) -> Result<SaveResult, String> {
    let _guard = lock_store()?;
    validate_store_json(json)?;
    fs::create_dir_all(&paths.app_data_dir)
        .map_err(|err| format!("创建应用数据目录失败：{}", err))?;
    atomic_write(&paths.store_path, json.as_bytes())?;

    let (backup_written, backup_path, mut backup_error) =
        match write_backup_if_needed(paths, json, false) {
            Ok((written, path)) => (written, path, None),
            Err(err) => (false, None, Some(err)),
        };
    if let Err(err) = prune_backups(paths) {
        backup_error = Some(match backup_error {
            Some(previous) => format!("{}；{}", previous, err),
            None => err,
        });
    }

    let info = paths.info();
    Ok(SaveResult {
        bytes: json.len(),
        saved_at: Local::now().to_rfc3339(),
        backup_written,
        backup_path: backup_path.as_deref().map(display),
        backup_error,
        store_path: info.store_path,
        backup_dir: info.backup_dir,
    })
}

pub fn force_backup(paths: &AppPaths, reason: &str) -> Result<BackupResult, String> {
    let _guard = lock_store()?;
    if !paths.store_path.exists() {
        return Ok(BackupResult {
            written: false,
            path: None,
            reason: reason.to_string(),
        });
    }
    let json = fs::read_to_string(&paths.store_path)
        .map_err(|err| format!("读取项目库失败：{}", err))?;
    let (written, path) = write_backup_if_needed(paths, &json, true)?;
    if written {
        let _ = prune_backups(paths);
    }
    Ok(BackupResult {
        written,
        path: path.as_deref().map(display),
        reason: reason.to_string(),
    })
}

fn validate_store_json(json: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(json)
        .map_err(|_| "拒绝写入：项目库 JSON 无法解析。".to_string())?;
    let version = value.get("schemaVersion").and_then(Value::as_u64);
    if version != Some(SCHEMA_VERSION) {
        return Err(format!(
            "拒绝写入：schemaVersion 必须是 {}。",
            SCHEMA_VERSION
        ));
    }
    let projects_ok = value
        .get("projects")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty() && items.iter().all(Value::is_object))
        .unwrap_or(false);
    if !projects_ok {
        return Err("拒绝写入：projects 必须是非空对象数组。".to_string());
    }
    Ok(())
}

/// 把路径归一化成可比较的键。
///
/// 已存在的一侧交给 `canonicalize`：它会解析 `..`、大小写别名、8.3 短名、
/// 符号链接与 junction，并返回磁盘上的实际拼写。目标尚不存在时（例如首次
/// 导出前项目库还没建），从最近的已存在祖先逐级回退，尾部文件名按 Windows
/// 规则忽略大小写与末尾的点、空格——这些字符在创建文件时会被系统丢掉。
fn same_target_key(path: &Path) -> String {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut ancestor = absolute.as_path();
    let mut missing: Vec<String> = Vec::new();
    let mut resolved: Option<PathBuf> = None;
    loop {
        if let Ok(value) = fs::canonicalize(ancestor) {
            resolved = Some(value);
            break;
        }
        match (ancestor.parent(), ancestor.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_string_lossy().into_owned());
                ancestor = parent;
            }
            _ => break,
        }
    }
    let mut key = match resolved {
        Some(value) => value.to_string_lossy().into_owned(),
        None => {
            // 整条路径都不存在：absolute 已经处理掉 `.` 与 `..`，不必再拼尾部。
            missing.clear();
            absolute.to_string_lossy().into_owned()
        }
    };
    #[cfg(windows)]
    if let Some(rest) = key.strip_prefix(r"\\?\UNC\") {
        key = format!(r"\\{}", rest);
    } else if let Some(rest) = key.strip_prefix(r"\\?\") {
        key = rest.to_string();
    }
    for name in missing.into_iter().rev() {
        if !key.ends_with(['\\', '/']) {
            key.push('\\');
        }
        key.push_str(&name);
    }
    #[cfg(windows)]
    {
        key = key.replace('/', "\\");
        let trimmed = key.trim_end_matches('\\');
        key = if trimmed.is_empty() {
            "\\".to_string()
        } else if trimmed.len() == 2 && trimmed.ends_with(':') {
            // 盘符根目录保留末尾反斜杠，避免 `C:` 被当成当前目录。
            format!("{}\\", trimmed)
        } else {
            trimmed.to_string()
        };
        // 最后再对每一段做 Windows 文件名归一化：`canonicalize` 成功时各段
        // 已是磁盘实际拼写，这一步主要兜住 `canonicalize` 整条都失败、
        // 只能退回 `absolute` 的情况；保留空段以维持 UNC 开头的两个反斜杠。
        let normalized: Vec<String> = key
            .split('\\')
            .map(|part| {
                let value = part.trim_end_matches([' ', '.']);
                if value.is_empty() && !part.is_empty() {
                    part.to_string()
                } else {
                    value.to_string()
                }
            })
            .collect();
        key = normalized.join("\\").to_lowercase();
    }
    #[cfg(not(windows))]
    {
        let trimmed = key.trim_end_matches('/');
        key = if trimmed.is_empty() {
            "/".to_string()
        } else {
            trimmed.to_string()
        };
    }
    key
}

/// 判断两个路径是否指向同一个目标。
///
/// 导出前用它挡住「改个大小写、绕个 `..`、借符号链接或 8.3 短名就能覆盖
/// 项目库」的情况。只用于保护性判断，不用于判断硬链接是否是同一份数据：
/// `atomic_write` 的临时文件 + 改名会替换目录项，不会改写另一个硬链接。
pub fn same_file_target(a: &Path, b: &Path) -> bool {
    same_target_key(a) == same_target_key(b)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标路径没有父目录。".to_string())?;
    fs::create_dir_all(parent).map_err(|err| format!("创建目录失败：{}", err))?;

    let file_name = path
        .file_name()
        .ok_or_else(|| "目标路径没有文件名。".to_string())?
        .to_string_lossy()
        .into_owned();
    let tmp = parent.join(format!(".{}.tmp-{}", file_name, std::process::id()));

    {
        let mut file = File::create(&tmp).map_err(|err| format!("创建临时文件失败：{}", err))?;
        file.write_all(bytes)
            .map_err(|err| format!("写入临时文件失败：{}", err))?;
        file.sync_all()
            .map_err(|err| format!("刷新临时文件失败：{}", err))?;
    }

    // Windows 的 std::fs::rename 使用 MoveFileExW(MOVEFILE_REPLACE_EXISTING)，
    // 可以覆盖已有文件；失败时保留原文件，只清掉临时文件。
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换文件失败：{}", err));
    }

    let written = fs::read(path).map_err(|err| format!("回读校验失败：{}", err))?;
    if written != bytes {
        return Err("写入校验失败：回读内容与写入内容不一致。".to_string());
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct BackupFile {
    path: PathBuf,
    date: NaiveDate,
    time: NaiveTime,
    seq: u32,
    force: bool,
}

impl BackupFile {
    fn stamp(&self) -> NaiveDateTime {
        NaiveDateTime::new(self.date, self.time)
    }
}

fn parse_backup_name(name: &str) -> Option<BackupFile> {
    let stem = name.strip_suffix(".json")?;
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() < 2 || parts[0].len() != 8 || parts[1].len() != 6 {
        return None;
    }
    if !parts[0].chars().all(|ch| ch.is_ascii_digit())
        || !parts[1].chars().all(|ch| ch.is_ascii_digit())
    {
        return None;
    }
    let date = NaiveDate::parse_from_str(parts[0], "%Y%m%d").ok()?;
    let time = NaiveTime::parse_from_str(parts[1], "%H%M%S").ok()?;
    let mut force = false;
    let mut seq = 0u32;
    for part in parts.iter().skip(2) {
        if *part == "force" {
            force = true;
        } else if let Ok(n) = part.parse::<u32>() {
            seq = n;
        } else {
            return None;
        }
    }
    Some(BackupFile {
        path: PathBuf::new(),
        date,
        time,
        seq,
        force,
    })
}

fn list_backups(dir: &Path) -> Result<Vec<BackupFile>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("读取备份目录失败：{}", err)),
    };
    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取备份目录失败：{}", err))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(mut backup) = parse_backup_name(&name) {
            backup.path = path;
            backups.push(backup);
        }
    }
    backups.sort_by_key(|backup| (backup.date, backup.time, backup.seq));
    Ok(backups)
}

fn strip_updated_at(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("updatedAt");
            for child in map.values_mut() {
                strip_updated_at(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                strip_updated_at(item);
            }
        }
        _ => {}
    }
}

fn normalized_for_backup(text: &str) -> Result<String, String> {
    let mut value: Value = serde_json::from_str(text)
        .map_err(|_| "当前项目库 JSON 无法解析，未写入备份。".to_string())?;
    strip_updated_at(&mut value);
    serde_json::to_string(&value)
        .map_err(|err| format!("备份内容序列化失败：{}", err))
}

fn write_backup_if_needed(
    paths: &AppPaths,
    json: &str,
    force: bool,
) -> Result<(bool, Option<PathBuf>), String> {
    let normalized = normalized_for_backup(json)?;
    let backups = list_backups(&paths.backup_dir)?;
    let now = Local::now().naive_local();

    if let Some(latest) = backups.last() {
        if let Ok(text) = fs::read_to_string(&latest.path) {
            if let Ok(previous) = normalized_for_backup(&text) {
                if previous == normalized {
                    return Ok((false, None));
                }
            }
        }
        let same_day = latest.date == now.date();
        let elapsed = (now - latest.stamp()).num_seconds();
        if !force && same_day && elapsed >= 0 && elapsed < MIN_BACKUP_INTERVAL_SECS {
            return Ok((false, None));
        }
    }

    fs::create_dir_all(&paths.backup_dir)
        .map_err(|err| format!("创建备份目录失败：{}", err))?;
    let base = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let suffix = if force { "-force" } else { "" };
    let mut target = paths.backup_dir.join(format!("{}{}.json", base, suffix));
    let mut n = 2;
    while target.exists() {
        target = paths
            .backup_dir
            .join(format!("{}{}-{}.json", base, suffix, n));
        n += 1;
    }
    atomic_write(&target, json.as_bytes())?;
    Ok((true, Some(target)))
}

fn prune_backups(paths: &AppPaths) -> Result<(), String> {
    let backups = list_backups(&paths.backup_dir)?;
    if backups.is_empty() {
        return Ok(());
    }
    let today = Local::now().date_naive();
    let cutoff = today - chrono::Duration::days(KEEP_DAILY_DAYS - 1);
    let mut keep: HashSet<PathBuf> = HashSet::new();

    for backup in backups.iter().rev().take(KEEP_RECENT) {
        keep.insert(backup.path.clone());
    }

    let mut seen_dates: HashSet<NaiveDate> = HashSet::new();
    for backup in &backups {
        if backup.date >= cutoff && seen_dates.insert(backup.date) {
            keep.insert(backup.path.clone());
        }
    }

    for backup in &backups {
        if backup.force && backup.date >= cutoff {
            keep.insert(backup.path.clone());
        }
    }

    for backup in &backups {
        if !keep.contains(&backup.path) {
            fs::remove_file(&backup.path)
                .map_err(|err| format!("清理旧备份失败：{}", err))?;
        }
    }
    Ok(())
}

pub fn read_import(path: &Path) -> Result<ImportResult, String> {
    let metadata = fs::metadata(path).map_err(|err| format!("读取文件信息失败：{}", err))?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err("JSON 文件超过 32 MB，未导入。".to_string());
    }
    let bytes = fs::read(path).map_err(|err| format!("读取文件失败：{}", err))?;
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err("JSON 文件超过 32 MB，未导入。".to_string());
    }
    let text = String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 编码。".to_string())?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "所选文件".to_string());
    Ok(ImportResult {
        path: display(path),
        name,
        size: metadata.len() as usize,
        text,
    })
}

pub fn sanitize_file_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        let bad = matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            || ch.is_control();
        out.push(if bad { '-' } else { ch });
    }
    let mut name = out.trim().trim_matches('.').trim().to_string();
    if name.is_empty() {
        name = "测量学三表".to_string();
    }
    if name.chars().count() > 120 {
        name = name.chars().take(120).collect();
    }
    if !name.to_ascii_lowercase().ends_with(".json") {
        name.push_str(".json");
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    fn temp_paths() -> AppPaths {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "survey-jujin-storage-test-{}-{}",
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        AppPaths::new(dir)
    }

    fn store_json(updated_at: &str, tag: &str) -> String {
        format!(
            r#"{{"schemaVersion":2,"activeProjectId":"p1","ui":{{"activeModule":"traverse"}},"projects":[{{"id":"p1","name":"测试","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"{}","state":{{"tag":"{}"}}}}]}}"#,
            updated_at, tag
        )
    }

    #[test]
    fn parse_backup_names_accepts_force_and_collision_suffix() {
        let plain = parse_backup_name("20261028-010203.json").unwrap();
        assert!(!plain.force);
        assert_eq!(plain.seq, 0);
        let forced = parse_backup_name("20261028-010203-force.json").unwrap();
        assert!(forced.force);
        let forced_copy = parse_backup_name("20261028-010203-force-2.json").unwrap();
        assert!(forced_copy.force);
        assert_eq!(forced_copy.seq, 2);
        assert!(parse_backup_name("2026-10-28.json").is_none());
        assert!(parse_backup_name("notes.json").is_none());
    }

    #[test]
    fn save_and_load_roundtrip_and_rejects_bad_json() {
        let paths = temp_paths();
        let json = store_json("2026-10-28T01:00:00.000Z", "a");
        let result = save(&paths, &json).unwrap();
        assert_eq!(result.bytes, json.len());
        assert_eq!(load(&paths).unwrap().text.as_deref(), Some(json.as_str()));
        assert!(save(&paths, "{not json").is_err());
        assert_eq!(load(&paths).unwrap().text.as_deref(), Some(json.as_str()));
    }

    #[test]
    fn corrupt_file_is_renamed_and_reported() {
        let paths = temp_paths();
        fs::write(&paths.store_path, b"{broken").unwrap();
        let loaded = load(&paths).unwrap();
        assert!(loaded.corrupt);
        assert!(loaded.text.is_none());
        assert!(!paths.store_path.exists());
        let corrupt_path = PathBuf::from(loaded.corrupt_path.unwrap());
        assert!(corrupt_path.exists());
        assert_eq!(fs::read(&corrupt_path).unwrap(), b"{broken");
    }

    #[test]
    fn future_schema_is_left_untouched() {
        let paths = temp_paths();
        let json = r#"{"schemaVersion":3,"projects":[{"id":"p"}]}"#;
        fs::write(&paths.store_path, json).unwrap();
        let loaded = load(&paths).unwrap();
        assert_eq!(loaded.future_version, Some(3));
        assert!(loaded.text.is_none());
        assert!(paths.store_path.exists());
        assert_eq!(fs::read_to_string(&paths.store_path).unwrap(), json);
    }

    #[test]
    fn backup_dedupes_updated_at_and_force_writes() {
        let paths = temp_paths();
        let first = store_json("2026-10-28T01:00:00.000Z", "same");
        save(&paths, &first).unwrap();
        let after_first = list_backups(&paths.backup_dir).unwrap();
        assert_eq!(after_first.len(), 1);

        let second = store_json("2026-10-28T01:00:05.000Z", "same");
        let result = save(&paths, &second).unwrap();
        assert!(!result.backup_written);
        assert_eq!(list_backups(&paths.backup_dir).unwrap().len(), 1);

        let forced = force_backup(&paths, "delete-project").unwrap();
        assert!(!forced.written, "unchanged content should not create a duplicate");
        assert_eq!(list_backups(&paths.backup_dir).unwrap().len(), 1);

        let third = store_json("2026-10-28T01:01:00.000Z", "changed");
        save(&paths, &third).unwrap();
        let forced = force_backup(&paths, "import").unwrap();
        assert!(forced.written);
        assert_eq!(list_backups(&paths.backup_dir).unwrap().len(), 2);
    }

    #[test]
    fn prune_keeps_recent_and_daily_first() {
        let paths = temp_paths();
        fs::create_dir_all(&paths.backup_dir).unwrap();
        let today = Local::now().date_naive();
        for i in 0..25 {
            let time = NaiveTime::from_hms_opt(0, 0, 0).unwrap()
                + chrono::Duration::seconds(i as i64);
            let name = format!("{}-{}.json", today.format("%Y%m%d"), time.format("%H%M%S"));
            fs::write(paths.backup_dir.join(name), store_json("x", &i.to_string())).unwrap();
        }
        prune_backups(&paths).unwrap();
        let left = list_backups(&paths.backup_dir).unwrap();
        assert_eq!(left.len(), 21, "20 recent + the first of the day");
        assert_eq!(left.first().unwrap().time, NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    }

    #[test]
    fn sanitize_file_name_removes_windows_reserved_characters() {
        assert_eq!(sanitize_file_name("a/b:c*?.json"), "a-b-c--.json");
        assert_eq!(sanitize_file_name("   "), "测量学三表.json");
    }

    #[test]
    fn same_file_target_matches_existing_store_aliases() {
        let paths = temp_paths();
        fs::write(&paths.store_path, b"{}").unwrap();
        assert!(same_file_target(&paths.store_path, &paths.store_path));
        #[cfg(windows)]
        {
            assert!(same_file_target(
                &paths.app_data_dir.join("STORE.JSON"),
                &paths.store_path
            ));
            assert!(same_file_target(
                &paths.app_data_dir.join("nope").join("..").join("Store.json"),
                &paths.store_path
            ));
            assert!(same_file_target(
                &PathBuf::from(format!(r"\\.\{}", paths.store_path.display())),
                &paths.store_path
            ));
        }
        assert!(!same_file_target(
            &paths.app_data_dir.join("other.json"),
            &paths.store_path
        ));
        assert!(!same_file_target(
            &paths.app_data_dir.join("sub").join("store.json"),
            &paths.store_path
        ));
    }

    #[test]
    fn same_file_target_covers_missing_store_spellings() {
        let paths = temp_paths();
        assert!(!paths.store_path.exists());
        assert!(same_file_target(&paths.store_path, &paths.store_path));
        #[cfg(windows)]
        {
            assert!(same_file_target(
                &paths.app_data_dir.join("Store.json"),
                &paths.store_path
            ));
            assert!(same_file_target(
                &paths.app_data_dir.join("store.json."),
                &paths.store_path
            ));
            assert!(same_file_target(
                &paths.app_data_dir.join("store.json "),
                &paths.store_path
            ));
            assert!(same_file_target(
                &paths
                    .app_data_dir
                    .join("missing")
                    .join("..")
                    .join("STORE.JSON"),
                &paths.store_path
            ));
            assert!(same_file_target(
                &PathBuf::from(format!(r"\\.\{}", paths.store_path.display())),
                &paths.store_path
            ));
        }
        assert!(!same_file_target(
            &paths.app_data_dir.join("store2.json"),
            &paths.store_path
        ));
        assert!(!same_file_target(
            &paths.app_data_dir.join("sub").join("store.json"),
            &paths.store_path
        ));
    }
}
