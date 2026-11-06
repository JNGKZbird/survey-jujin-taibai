//! 按 providerId 分槽保存 API Key。
//!
//! 前端只能查询“有没有”、设置、清除；明文只在 Rust 内部读取后直接用于请求，
//! 永远不会经命令返回值、日志或 `agent.json` 回到界面。

const USER_NAME: &str = "api-key";
const TARGET_PREFIX: &str = "survey-jujin";

pub fn target_for(provider_id: &str, scope: &str) -> Result<String, String> {
    if !valid_provider_id(provider_id) {
        return Err("bad_provider".to_string());
    }
    let scope = match scope {
        "llm" | "search" => scope,
        _ => return Err("bad_scope".to_string()),
    };
    Ok(format!("{TARGET_PREFIX}/{scope}/{provider_id}"))
}

pub fn valid_provider_id(value: &str) -> bool {
    let len = value.len();
    (1..=32).contains(&len)
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

pub fn read_key(provider_id: &str, scope: &str) -> Result<Option<String>, String> {
    let target = target_for(provider_id, scope)?;
    read_key_from(&target)
}

#[tauri::command]
pub fn agent_key_has(provider_id: String, scope: Option<String>) -> Result<bool, String> {
    let scope = scope.as_deref().unwrap_or("llm");
    Ok(read_key(&provider_id, scope)?.is_some())
}

#[tauri::command]
pub fn agent_key_set(
    provider_id: String,
    key: String,
    scope: Option<String>,
) -> Result<(), String> {
    let scope = scope.as_deref().unwrap_or("llm");
    let target = target_for(&provider_id, scope)?;
    let trimmed = key.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 {
        return Err("bad_request".to_string());
    }
    write_key_to(&target, trimmed)
}

#[tauri::command]
pub fn agent_key_clear(provider_id: String, scope: Option<String>) -> Result<(), String> {
    let scope = scope.as_deref().unwrap_or("llm");
    let target = target_for(&provider_id, scope)?;
    delete_key(&target)
}

#[cfg(windows)]
fn read_key_from(target: &str) -> Result<Option<String>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target_w: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
    if unsafe {
        CredReadW(
            PCWSTR(target_w.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &mut ptr,
        )
    }
    .is_err()
    {
        return Ok(None);
    }
    if ptr.is_null() {
        return Ok(None);
    }

    let decoded = unsafe {
        let cred = &*ptr;
        let bytes =
            std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        let decoded = String::from_utf8(bytes.to_vec());
        CredFree(ptr as *const core::ffi::c_void);
        decoded
    };

    match decoded {
        Ok(text) if !text.trim().is_empty() => Ok(Some(text.trim().to_string())),
        _ => Ok(None),
    }
}

#[cfg(windows)]
fn write_key_to(target: &str, key: &str) -> Result<(), String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut target_w: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut user_w: Vec<u16> = USER_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    let mut blob = key.as_bytes().to_vec();

    let credential = CREDENTIALW {
        Flags: Default::default(),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target_w.as_mut_ptr()),
        Comment: PWSTR::null(),
        LastWritten: Default::default(),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: PWSTR::null(),
        UserName: PWSTR(user_w.as_mut_ptr()),
    };

    unsafe { CredWriteW(&credential, 0) }.map_err(|_| "storage_error".to_string())
}

#[cfg(windows)]
fn delete_key(target: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target_w: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    match unsafe { CredDeleteW(PCWSTR(target_w.as_ptr()), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(()),
        Err(_) => Ok(()),
    }
}

#[cfg(not(windows))]
fn read_key_from(_target: &str) -> Result<Option<String>, String> {
    Err("unknown".to_string())
}

#[cfg(not(windows))]
fn write_key_to(_target: &str, _key: &str) -> Result<(), String> {
    Err("unknown".to_string())
}

#[cfg(not(windows))]
fn delete_key(_target: &str) -> Result<(), String> {
    Err("unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_are_locked_down() {
        assert!(valid_provider_id("deepseek"));
        assert!(valid_provider_id("my-gateway_2"));
        assert!(!valid_provider_id(""));
        assert!(!valid_provider_id("../deepseek"));
        assert!(!valid_provider_id("DeepSeek"));
        assert!(!valid_provider_id("a".repeat(33).as_str()));
    }

    #[test]
    fn targets_are_namespaced_by_scope() {
        assert_eq!(
            target_for("deepseek", "llm").unwrap(),
            "survey-jujin/llm/deepseek"
        );
        assert_eq!(
            target_for("tavily", "search").unwrap(),
            "survey-jujin/search/tavily"
        );
        assert_eq!(target_for("x", "other").unwrap_err(), "bad_scope");
    }
}
