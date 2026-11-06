//! `agent.json` 的原子读写。
//!
//! 与项目库 `store.json` 完全分开：对话、人格、非敏感设置都进这里，API Key
//! 只进 Windows 凭据管理器。文件损坏时先隔离再重建，绝不静默覆盖。

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::storage::atomic_write;

pub const AGENT_SCHEMA_VERSION: u64 = 1;
pub const MAX_AGENT_BYTES: u64 = 16 * 1024 * 1024;

pub struct AgentPaths {
    pub agent_path: PathBuf,
    pub backup_path: PathBuf,
}

impl AgentPaths {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            agent_path: app_data_dir.join("agent.json"),
            backup_path: app_data_dir.join("agent.json.bak"),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoadResult {
    pub text: Option<String>,
    pub path: String,
    pub backup_path: String,
    pub bytes: u64,
    pub corrupt: bool,
    pub corrupt_path: Option<String>,
    pub future_version: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSaveResult {
    pub path: String,
    pub backup_path: String,
    pub bytes: u64,
    pub backup_written: bool,
}

pub fn load(paths: &AgentPaths) -> AgentLoadResult {
    let path_text = paths.agent_path.to_string_lossy().into_owned();
    let backup_text = paths.backup_path.to_string_lossy().into_owned();

    if !paths.agent_path.exists() {
        return AgentLoadResult {
            text: None,
            path: path_text,
            backup_path: backup_text,
            bytes: 0,
            corrupt: false,
            corrupt_path: None,
            future_version: None,
        };
    }

    let metadata = match fs::metadata(&paths.agent_path) {
        Ok(metadata) => metadata,
        Err(_) => {
            return AgentLoadResult {
                text: None,
                path: path_text,
                backup_path: backup_text,
                bytes: 0,
                corrupt: true,
                corrupt_path: None,
                future_version: None,
            };
        }
    };

    if metadata.len() > MAX_AGENT_BYTES {
        let corrupt_path = quarantine(&paths.agent_path);
        return AgentLoadResult {
            text: None,
            path: path_text,
            backup_path: backup_text,
            bytes: metadata.len(),
            corrupt: true,
            corrupt_path,
            future_version: None,
        };
    }

    let bytes = match fs::read(&paths.agent_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return AgentLoadResult {
                text: None,
                path: path_text,
                backup_path: backup_text,
                bytes: metadata.len(),
                corrupt: true,
                corrupt_path: None,
                future_version: None,
            };
        }
    };

    let text = match String::from_utf8(bytes.clone()) {
        Ok(text) => text,
        Err(_) => {
            let corrupt_path = quarantine(&paths.agent_path);
            return AgentLoadResult {
                text: None,
                path: path_text,
                backup_path: backup_text,
                bytes: metadata.len(),
                corrupt: true,
                corrupt_path,
                future_version: None,
            };
        }
    };

    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => {
            let corrupt_path = quarantine(&paths.agent_path);
            return AgentLoadResult {
                text: None,
                path: path_text,
                backup_path: backup_text,
                bytes: metadata.len(),
                corrupt: true,
                corrupt_path,
                future_version: None,
            };
        }
    };

    if !value.is_object() {
        let corrupt_path = quarantine(&paths.agent_path);
        return AgentLoadResult {
            text: None,
            path: path_text,
            backup_path: backup_text,
            bytes: metadata.len(),
            corrupt: true,
            corrupt_path,
            future_version: None,
        };
    }

    let version = value.get("version").and_then(serde_json::Value::as_u64);
    if let Some(version) = version {
        if version > AGENT_SCHEMA_VERSION {
            return AgentLoadResult {
                text: Some(text),
                path: path_text,
                backup_path: backup_text,
                bytes: metadata.len(),
                corrupt: false,
                corrupt_path: None,
                future_version: Some(version),
            };
        }
    }

    if version != Some(AGENT_SCHEMA_VERSION) {
        let corrupt_path = quarantine(&paths.agent_path);
        return AgentLoadResult {
            text: None,
            path: path_text,
            backup_path: backup_text,
            bytes: metadata.len(),
            corrupt: true,
            corrupt_path,
            future_version: None,
        };
    }

    AgentLoadResult {
        text: Some(text),
        path: path_text,
        backup_path: backup_text,
        bytes: metadata.len(),
        corrupt: false,
        corrupt_path: None,
        future_version: None,
    }
}

pub fn save(paths: &AgentPaths, json: &str) -> Result<AgentSaveResult, String> {
    let bytes = json.as_bytes();
    if bytes.len() as u64 > MAX_AGENT_BYTES {
        return Err("agent_store_too_large".to_string());
    }

    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|_| "agent_store_bad_json".to_string())?;
    if !value.is_object() {
        return Err("agent_store_bad_json".to_string());
    }
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "agent_store_bad_json".to_string())?;
    if version > AGENT_SCHEMA_VERSION {
        return Err("agent_store_future_version".to_string());
    }
    if version != AGENT_SCHEMA_VERSION {
        return Err("agent_store_bad_json".to_string());
    }

    // 旧版本先留一份 .bak，再原子替换；备份失败不阻断本次保存。
    let mut backup_written = false;
    if paths.agent_path.exists() {
        if let Ok(previous) = fs::read(&paths.agent_path) {
            if previous.len() as u64 <= MAX_AGENT_BYTES {
                backup_written = atomic_write(&paths.backup_path, &previous).is_ok();
            }
        }
    }

    atomic_write(&paths.agent_path, bytes)?;

    Ok(AgentSaveResult {
        path: paths.agent_path.to_string_lossy().into_owned(),
        backup_path: paths.backup_path.to_string_lossy().into_owned(),
        bytes: bytes.len() as u64,
        backup_written,
    })
}

fn quarantine(path: &std::path::Path) -> Option<String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let target = path.with_file_name(format!("agent.corrupt-{stamp}.json"));
    fs::rename(path, &target).ok()?;
    Some(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "survey-jujin-agent-store-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn valid() -> String {
        r#"{"version":1,"settings":{},"workspaces":{}}"#.to_string()
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = temp_dir("missing");
        let paths = AgentPaths::new(dir.clone());
        let result = load(&paths);
        assert!(result.text.is_none());
        assert!(!result.corrupt);
        assert_eq!(result.bytes, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn saves_and_reads_back_with_backup() {
        let dir = temp_dir("roundtrip");
        let paths = AgentPaths::new(dir.clone());
        save(&paths, &valid()).unwrap();
        save(&paths, r#"{"version":1,"settings":{"model":"x"},"workspaces":{}}"#).unwrap();
        assert!(paths.backup_path.exists());
        let result = load(&paths);
        assert!(result.text.unwrap().contains("\"model\":\"x\""));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_json_is_quarantined_not_overwritten() {
        let dir = temp_dir("corrupt");
        let paths = AgentPaths::new(dir.clone());
        fs::write(&paths.agent_path, b"{not json").unwrap();
        let result = load(&paths);
        assert!(result.corrupt);
        assert!(!paths.agent_path.exists());
        let quarantined = result.corrupt_path.expect("quarantine path");
        assert!(std::path::Path::new(&quarantined).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn future_version_is_preserved() {
        let dir = temp_dir("future");
        let paths = AgentPaths::new(dir.clone());
        fs::write(&paths.agent_path, br#"{"version":9,"settings":{}}"#).unwrap();
        let result = load(&paths);
        assert!(!result.corrupt);
        assert_eq!(result.future_version, Some(9));
        assert!(paths.agent_path.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_or_too_large_payloads() {
        let dir = temp_dir("bad");
        let paths = AgentPaths::new(dir.clone());
        assert_eq!(save(&paths, "[]").unwrap_err(), "agent_store_bad_json");
        assert_eq!(
            save(&paths, r#"{"version":2}"#).unwrap_err(),
            "agent_store_future_version"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
