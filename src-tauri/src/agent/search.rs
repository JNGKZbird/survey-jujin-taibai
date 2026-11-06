//! DeepSeek 官方联网搜索。
//!
//! 固定端点，不跟随重定向，Key 只从 Windows 凭据管理器读取后直接放进
//! Authorization 头；返回值里绝不包含 Key。搜索结果只做元数据归一化，
//! 不抓网页正文。

use std::collections::HashSet;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use url::{Host, Url};

use super::{credentials, llm};

const SEARCH_URL: &str = "https://api.deepseek.com/v1/tools/search";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_COUNT: usize = 6;
const MAX_COUNT: usize = 8;
const MAX_QUERY_CHARS: usize = 128;
const MAX_RESULTS: usize = 8;
const MAX_URL_CHARS: usize = 1024;
const MAX_TITLE_CHARS: usize = 300;
const MAX_SITE_CHARS: usize = 80;
const MAX_DATE_CHARS: usize = 32;
const MAX_SUMMARY_CHARS: usize = 1200;
const DETAIL_LIMIT: usize = 300;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub site: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<SearchResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl SearchResponse {
    fn ok(query: String, results: Vec<SearchResult>) -> Self {
        Self {
            ok: true,
            provider: Some("deepseek".to_string()),
            query: Some(query),
            count: Some(results.len()),
            results: Some(results),
            code: None,
            detail: None,
        }
    }

    fn err(code: &str, detail: Option<String>) -> Self {
        Self {
            ok: false,
            provider: None,
            query: None,
            count: None,
            results: None,
            code: Some(code.to_string()),
            detail,
        }
    }
}

type Failure = (String, Option<String>);

fn clean_text(value: &str, limit: usize) -> String {
    let filtered: String = value
        .chars()
        .filter(|ch| !ch.is_control() || *ch == '\n' || *ch == '\t')
        .collect();
    let collapsed = filtered.split_whitespace().collect::<Vec<_>>().join(" ");
    llm::truncate(&collapsed, limit)
}

fn normalize_query(value: &str) -> Result<String, Failure> {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return Err(("bad_request".to_string(), Some("query 不能为空。".to_string())));
    }
    if collapsed.chars().count() > MAX_QUERY_CHARS {
        return Err((
            "bad_request".to_string(),
            Some(format!("query 最长 {MAX_QUERY_CHARS} 个字符。")),
        ));
    }
    Ok(collapsed)
}

fn clamp_count(value: Option<u32>) -> usize {
    value.unwrap_or(DEFAULT_COUNT as u32).clamp(1, MAX_COUNT as u32) as usize
}

fn safe_result_url(text: &str) -> Option<Url> {
    if text.is_empty() || text.chars().count() > MAX_URL_CHARS {
        return None;
    }
    let parsed = Url::parse(text).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return None;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return None;
    }
    match parsed.host()? {
        Host::Domain(domain) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            if domain == "localhost"
                || domain.ends_with(".localhost")
                || domain.ends_with(".local")
            {
                return None;
            }
        }
        Host::Ipv4(ip) => {
            let octets = ip.octets();
            let cgnat = octets[0] == 100 && (64..=127).contains(&octets[1]);
            if ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.is_multicast()
                || cgnat
            {
                return None;
            }
        }
        Host::Ipv6(ip) => {
            if ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
            {
                return None;
            }
        }
    }
    Some(parsed)
}

fn host_label(url: &Url) -> String {
    let host = url.host_str().unwrap_or("").trim_end_matches('.');
    let host = host.strip_prefix("www.").unwrap_or(host);
    llm::truncate(host, MAX_SITE_CHARS)
}

fn dedup_key(url: &Url) -> String {
    let mut copy = url.clone();
    copy.set_fragment(None);
    copy.to_string()
}

fn normalize_results(items: &[Value]) -> Vec<SearchResult> {
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for item in items {
        if out.len() >= MAX_RESULTS {
            break;
        }
        let raw_url = item.get("url").and_then(Value::as_str).unwrap_or("");
        let parsed = match safe_result_url(raw_url) {
            Some(url) => url,
            None => continue,
        };
        if !seen.insert(dedup_key(&parsed)) {
            continue;
        }
        let site = host_label(&parsed);
        let title_raw = item.get("title").and_then(Value::as_str).unwrap_or("");
        let title = clean_text(title_raw, MAX_TITLE_CHARS);
        let title = if title.is_empty() { site.clone() } else { title };
        let date_raw = item.get("date").and_then(Value::as_str).unwrap_or("");
        let date = clean_text(date_raw, MAX_DATE_CHARS);
        let summary_raw = item
            .get("summary")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .or_else(|| item.get("snippet").and_then(Value::as_str))
            .unwrap_or("");
        let summary = clean_text(summary_raw, MAX_SUMMARY_CHARS);
        out.push(SearchResult {
            title,
            url: parsed.to_string(),
            site,
            date: (!date.is_empty()).then_some(date),
            summary: (!summary.is_empty()).then_some(summary),
        });
    }
    out
}

fn status_code(status: u16) -> &'static str {
    match status {
        400 => "bad_request",
        401 => "invalid_key",
        402 => "insufficient_balance",
        403 => "forbidden",
        404 => "not_found",
        408 => "timeout",
        413 => "too_large",
        429 => "rate_limited",
        300..=399 => "bad_response",
        500..=599 => "server_error",
        _ => "bad_response",
    }
}

fn detail_from_body(body: &str) -> Option<String> {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.to_string());
    let text = llm::truncate(message.trim(), DETAIL_LIMIT);
    (!text.is_empty()).then_some(text)
}

fn read_api_key() -> Result<String, Failure> {
    match credentials::read_key("deepseek", "llm") {
        Ok(Some(key)) if !key.trim().is_empty() => Ok(key),
        Ok(_) => Err(("no_key".to_string(), None)),
        Err(_) => Err((
            "credential_error".to_string(),
            Some("无法读取 Windows 凭据管理器。".to_string()),
        )),
    }
}

async fn read_body_limited(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, Failure> {
    if response.content_length().map(|len| len > limit as u64) == Some(true) {
        return Err(("too_large".to_string(), None));
    }
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len() + chunk.len() > limit {
                    return Err(("too_large".to_string(), None));
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(buf),
            Err(error) => {
                return Err((
                    llm::network_code(&error).to_string(),
                    Some(error.to_string()),
                ));
            }
        }
    }
}

async fn request_search(query: &str, count: usize) -> Result<Vec<u8>, Failure> {
    let key = read_api_key()?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| ("network".to_string(), None))?;
    let body = json!({ "query": query, "count": count });
    let response = tokio::time::timeout(TOTAL_TIMEOUT, async {
        let response = client
            .post(SEARCH_URL)
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                (
                    llm::network_code(&error).to_string(),
                    Some(error.to_string()),
                )
            })?;
        let status = response.status().as_u16();
        let bytes = read_body_limited(response, MAX_BODY_BYTES).await?;
        Ok::<(u16, Vec<u8>), Failure>((status, bytes))
    })
    .await
    .map_err(|_| ("timeout".to_string(), None))??;
    let (status, bytes) = response;
    if !(200..=299).contains(&status) {
        let text = String::from_utf8_lossy(&bytes);
        return Err((status_code(status).to_string(), detail_from_body(&text)));
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn agent_web_search(query: String, count: Option<u32>) -> SearchResponse {
    let query = match normalize_query(&query) {
        Ok(query) => query,
        Err((code, detail)) => return SearchResponse::err(&code, detail),
    };
    let count = clamp_count(count);
    let bytes = match request_search(&query, count).await {
        Ok(bytes) => bytes,
        Err((code, detail)) => return SearchResponse::err(&code, detail),
    };
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => {
            return SearchResponse::err(
                "bad_response",
                Some("搜索服务返回了无法解析的结果。".to_string()),
            );
        }
    };
    let items = match value.get("results").and_then(Value::as_array) {
        Some(items) => items,
        None => {
            return SearchResponse::err(
                "bad_response",
                Some("搜索服务没有返回 results 数组。".to_string()),
            );
        }
    };
    SearchResponse::ok(query, normalize_results(items))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_is_trimmed_and_limited() {
        assert_eq!(normalize_query("  a   b \n c ").unwrap(), "a b c");
        assert_eq!(normalize_query("   ").unwrap_err().0, "bad_request");
        let ok = "中".repeat(MAX_QUERY_CHARS);
        assert!(normalize_query(&ok).is_ok());
        let too_long = "中".repeat(MAX_QUERY_CHARS + 1);
        assert_eq!(normalize_query(&too_long).unwrap_err().0, "bad_request");
    }

    #[test]
    fn count_is_clamped() {
        assert_eq!(clamp_count(None), DEFAULT_COUNT);
        assert_eq!(clamp_count(Some(0)), 1);
        assert_eq!(clamp_count(Some(99)), MAX_COUNT);
    }

    #[test]
    fn result_urls_must_be_public_http() {
        assert!(safe_result_url("https://example.com/a").is_some());
        assert!(safe_result_url("http://example.com/a").is_some());
        assert!(safe_result_url("ftp://example.com/a").is_none());
        assert!(safe_result_url("javascript:alert(1)").is_none());
        assert!(safe_result_url("data:text/html,hi").is_none());
        assert!(safe_result_url("https://user:pass@example.com/").is_none());
        assert!(safe_result_url("http://localhost/").is_none());
        assert!(safe_result_url("http://foo.localhost/").is_none());
        assert!(safe_result_url("http://printer.local/").is_none());
        assert!(safe_result_url("http://127.0.0.1/").is_none());
        assert!(safe_result_url("http://10.1.2.3/").is_none());
        assert!(safe_result_url("http://192.168.1.1/").is_none());
        assert!(safe_result_url("http://169.254.1.1/").is_none());
        assert!(safe_result_url("http://100.64.0.1/").is_none());
        assert!(safe_result_url("http://[::1]/").is_none());
        assert!(safe_result_url("http://[fc00::1]/").is_none());
    }

    #[test]
    fn results_are_normalized_and_deduped() {
        let items = vec![
            json!({
                "title": "  Example \n Title ",
                "url": "https://www.example.com/a#frag",
                "date": "2026-11-01T00:00:00Z",
                "summary": "  a  summary "
            }),
            json!({
                "title": "duplicate",
                "url": "https://www.example.com/a#other",
                "snippet": "should be skipped"
            }),
            json!({
                "title": "",
                "url": "https://b.example.com/x",
                "snippet": "fallback"
            }),
            json!({
                "title": "bad",
                "url": "http://127.0.0.1/secret"
            })
        ];
        let out = normalize_results(&items);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].title, "Example Title");
        assert_eq!(out[0].site, "example.com");
        assert_eq!(out[0].date.as_deref(), Some("2026-11-01T00:00:00Z"));
        assert_eq!(out[0].summary.as_deref(), Some("a summary"));
        assert_eq!(out[1].title, "b.example.com");
        assert_eq!(out[1].summary.as_deref(), Some("fallback"));
    }

    #[test]
    fn results_are_capped() {
        let items: Vec<Value> = (0..12)
            .map(|index| {
                json!({
                    "title": format!("title {index}"),
                    "url": format!("https://example.com/{index}")
                })
            })
            .collect();
        assert_eq!(normalize_results(&items).len(), MAX_RESULTS);
    }

    #[test]
    fn status_codes_are_mapped() {
        assert_eq!(status_code(400), "bad_request");
        assert_eq!(status_code(401), "invalid_key");
        assert_eq!(status_code(402), "insufficient_balance");
        assert_eq!(status_code(403), "forbidden");
        assert_eq!(status_code(404), "not_found");
        assert_eq!(status_code(408), "timeout");
        assert_eq!(status_code(413), "too_large");
        assert_eq!(status_code(429), "rate_limited");
        assert_eq!(status_code(500), "server_error");
        assert_eq!(status_code(302), "bad_response");
    }

    #[test]
    fn error_detail_prefers_json_message() {
        let body = r#"{"error":{"message":"bad query"}}"#;
        assert_eq!(detail_from_body(body).as_deref(), Some("bad query"));
        assert_eq!(detail_from_body("  plain error  ").as_deref(), Some("plain error"));
    }

    #[test]
    fn empty_results_are_ok() {
        let response = SearchResponse::ok("q".to_string(), Vec::new());
        assert!(response.ok);
        assert_eq!(response.count, Some(0));
        assert_eq!(response.results.unwrap().len(), 0);
    }
}
