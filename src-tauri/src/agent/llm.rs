//! OpenAI 兼容的流式/一次性客户端。
//!
//! SSE 按字节切行，完整行才做 UTF-8 解码，中文与 emoji 被网络 chunk 切断也
//! 不会坏。usage 在 `choices` 判空之前解析，避免丢掉 usage-only 尾块。
//! `tool_calls` 按 index 累积，流结束时一次性发给前端。

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::ipc::Channel;
use url::Url;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);
const COMPLETE_TIMEOUT: Duration = Duration::from_secs(120);
const MODELS_TIMEOUT: Duration = Duration::from_secs(25);
const DETAIL_LIMIT: usize = 300;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamRequest {
    pub request_id: String,
    pub provider_id: String,
    pub base_url: String,
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub thinking: Option<Value>,
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub tool_choice: Option<Value>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub provider_id: String,
    pub base_url: String,
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub thinking: Option<Value>,
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub tool_choice: Option<Value>,
}

fn default_temperature() -> f64 {
    1.0
}

fn default_max_tokens() -> u32 {
    4096
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: CompletedFunction,
}

#[derive(Clone, Serialize)]
pub struct CompletedFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent {
    Delta {
        text: String,
    },
    Reasoning {
        text: String,
    },
    ToolCalls {
        calls: Vec<CompletedToolCall>,
    },
    Usage {
        prompt_tokens: u32,
        completion_tokens: u32,
        total_tokens: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_hit_tokens: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_miss_tokens: Option<u32>,
    },
    Done {
        #[serde(skip_serializing_if = "Option::is_none")]
        finish_reason: Option<String>,
        aborted: bool,
        tools_dropped: bool,
    },
    Error {
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub cache_hit_tokens: Option<u32>,
    pub cache_miss_tokens: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Parsed {
    Delta(String),
    Reasoning(String),
    ToolCall(ToolCallDelta),
    Usage(Usage),
    Finish(String),
    Done,
    Error(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResult {
    pub content: String,
    pub reasoning: Option<String>,
    pub tool_calls: Option<Value>,
    pub usage: Option<Value>,
}

/// 只收集完整行；不完整的尾巴留在 buffer 里等下一个 chunk。
#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
}

impl SseParser {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.buffer.extend_from_slice(bytes);
        let mut payloads = Vec::new();

        while let Some(newline) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            let line = std::str::from_utf8(&line).map_err(|_| "bad_request".to_string())?;
            if let Some(rest) = line.strip_prefix("data:") {
                payloads.push(rest.trim_start().to_string());
            }
        }

        Ok(payloads)
    }
}

pub fn parse_payload(payload: &str) -> Result<Vec<Parsed>, String> {
    let payload = payload.trim();
    if payload.is_empty() {
        return Ok(Vec::new());
    }
    if payload == "[DONE]" {
        return Ok(vec![Parsed::Done]);
    }

    let value: Value = serde_json::from_str(payload).map_err(|_| "bad_request".to_string())?;

    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("stream error");
        return Ok(vec![Parsed::Error(message.to_string())]);
    }

    let mut out = Vec::new();

    // usage-only 尾块的 choices 是空数组，必须放在 choices 判空之前。
    if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
        if let Some(usage) = parse_usage(usage) {
            out.push(Parsed::Usage(usage));
        }
    }

    if let Some(choices) = value.get("choices").and_then(Value::as_array) {
        for choice in choices {
            if let Some(delta) = choice.get("delta") {
                if let Some(text) = delta.get("reasoning_content").and_then(Value::as_str) {
                    if !text.is_empty() {
                        out.push(Parsed::Reasoning(text.to_string()));
                    }
                }
                if let Some(text) = delta.get("content").and_then(Value::as_str) {
                    if !text.is_empty() {
                        out.push(Parsed::Delta(text.to_string()));
                    }
                }
                if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
                    for call in calls {
                        let index = call
                            .get("index")
                            .and_then(Value::as_u64)
                            .unwrap_or(0) as usize;
                        let id = call
                            .get("id")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .map(str::to_string);
                        let function = call.get("function");
                        let name = function
                            .and_then(|f| f.get("name"))
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                            .map(str::to_string);
                        let arguments = function
                            .and_then(|f| f.get("arguments"))
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        out.push(Parsed::ToolCall(ToolCallDelta {
                            index,
                            id,
                            name,
                            arguments,
                        }));
                    }
                }
            }
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                out.push(Parsed::Finish(reason.to_string()));
            }
        }
    }

    Ok(out)
}

fn parse_usage(value: &Value) -> Option<Usage> {
    Some(Usage {
        prompt_tokens: value.get("prompt_tokens")?.as_u64()? as u32,
        completion_tokens: value.get("completion_tokens")?.as_u64()? as u32,
        total_tokens: value.get("total_tokens")?.as_u64()? as u32,
        cache_hit_tokens: value
            .get("prompt_cache_hit_tokens")
            .and_then(Value::as_u64)
            .map(|n| n as u32),
        cache_miss_tokens: value
            .get("prompt_cache_miss_tokens")
            .and_then(Value::as_u64)
            .map(|n| n as u32),
    })
}

pub fn normalize_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("not_configured".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "bad_url".to_string())?;
    let loopback = matches!(
        parsed.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1")
    );
    let scheme_ok = parsed.scheme() == "https" || (parsed.scheme() == "http" && loopback);
    if !scheme_ok || parsed.host_str().is_none() {
        return Err("bad_url".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("bad_url".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn endpoint(base_url: &str) -> Result<String, String> {
    let base = normalize_base_url(base_url)?;
    if base.ends_with("/chat/completions") {
        return Ok(base);
    }
    Ok(format!("{base}/chat/completions"))
}

pub fn models_endpoint(base_url: &str) -> Result<String, String> {
    let base = normalize_base_url(base_url)?;
    let base = base
        .strip_suffix("/chat/completions")
        .unwrap_or(base.as_str())
        .trim_end_matches('/');
    if base.ends_with("/models") {
        Ok(base.to_string())
    } else {
        Ok(format!("{base}/models"))
    }
}

struct RequestParts<'a> {
    model: &'a str,
    messages: &'a [Value],
    temperature: f64,
    max_tokens: u32,
    thinking: Option<&'a Value>,
    tools: Option<&'a Value>,
    tool_choice: Option<&'a Value>,
}

fn build_body(parts: &RequestParts<'_>, stream: bool) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), json!(parts.model));
    body.insert(
        "messages".to_string(),
        Value::Array(parts.messages.to_vec()),
    );
    body.insert("temperature".to_string(), json!(parts.temperature));
    body.insert("max_tokens".to_string(), json!(parts.max_tokens));
    body.insert("stream".to_string(), json!(stream));
    if stream {
        body.insert(
            "stream_options".to_string(),
            json!({ "include_usage": true }),
        );
    }

    if let Some(Value::Object(extra)) = parts.thinking {
        for (key, value) in extra {
            body.insert(key.clone(), value.clone());
        }
    }

    if let Some(tools) = parts.tools {
        if tools.as_array().map(|items| !items.is_empty()).unwrap_or(false) {
            body.insert("tools".to_string(), tools.clone());
            if let Some(choice) = parts.tool_choice {
                body.insert("tool_choice".to_string(), choice.clone());
            }
        }
    }

    Value::Object(body)
}

fn without(value: &Value, keys: &[&str]) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    for key in keys {
        object.remove(*key);
    }
    Value::Object(object)
}

fn request_bodies(parts: &RequestParts<'_>, stream: bool) -> Vec<Value> {
    let full = build_body(parts, stream);
    // 供应商通常只报第一个不兼容参数；按这个顺序逐个剥掉，只在前端尚未收到
    // 任何 token 时重试。thinking 的字段名因提供商而异，一起剥。
    let variants = [
        full.clone(),
        without(&full, &["temperature"]),
        without(&full, &["temperature", "stream_options"]),
        without(
            &full,
            &["temperature", "stream_options", "max_tokens"],
        ),
        without(
            &full,
            &[
                "temperature",
                "stream_options",
                "max_tokens",
                "thinking",
                "reasoning_effort",
                "enable_thinking",
                "thinking_budget",
            ],
        ),
        without(
            &full,
            &[
                "temperature",
                "stream_options",
                "max_tokens",
                "thinking",
                "reasoning_effort",
                "enable_thinking",
                "thinking_budget",
                "tools",
                "tool_choice",
            ],
        ),
    ];

    let mut out: Vec<Value> = Vec::new();
    for variant in variants {
        if !out.iter().any(|existing| existing == &variant) {
            out.push(variant);
        }
    }
    out
}

fn body_has_tools(body: &Value) -> bool {
    body.get("tools")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
}

fn status_code(status: u16) -> &'static str {
    match status {
        400 => "bad_request",
        401 => "invalid_key",
        402 => "insufficient_balance",
        403 => "forbidden",
        404 => "model_not_found",
        408 => "timeout",
        413 => "too_large",
        429 => "rate_limited",
        500..=599 => "server_error",
        _ => "unknown",
    }
}

pub(crate) fn network_code(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else {
        "network"
    }
}

pub(crate) fn truncate(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn detail(text: String) -> Option<String> {
    let text = truncate(text.trim(), DETAIL_LIMIT);
    (!text.is_empty()).then_some(text)
}

fn send(channel: &Channel<StreamEvent>, event: StreamEvent) -> Result<(), String> {
    channel.send(event).map_err(|_| "unknown".to_string())
}

#[derive(Default, Clone)]
struct ToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

fn completed_calls(acc: &BTreeMap<usize, ToolCallAcc>) -> Vec<CompletedToolCall> {
    acc.values()
        .filter(|call| !call.name.is_empty())
        .map(|call| CompletedToolCall {
            id: call.id.clone(),
            kind: "function".to_string(),
            function: CompletedFunction {
                name: call.name.clone(),
                arguments: call.arguments.clone(),
            },
        })
        .collect()
}

fn finish_stream(
    channel: &Channel<StreamEvent>,
    calls: &BTreeMap<usize, ToolCallAcc>,
    finish_reason: Option<String>,
    aborted: bool,
    tools_dropped: bool,
) -> Result<(), String> {
    if !aborted {
        let completed = completed_calls(calls);
        if !completed.is_empty() {
            send(channel, StreamEvent::ToolCalls { calls: completed })?;
        }
    }
    send(
        channel,
        StreamEvent::Done {
            finish_reason,
            aborted,
            tools_dropped,
        },
    )
}

fn client(connect_timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(connect_timeout)
        .build()
        .map_err(|_| "network".to_string())
}

async fn post_with_degrade(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    bodies: &[Value],
) -> Result<(reqwest::Response, usize), (String, Option<String>)> {
    let mut attempt = 0usize;
    loop {
        let response = client
            .post(url)
            .bearer_auth(api_key)
            .json(&bodies[attempt])
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                return Ok((response, attempt));
            }
            Ok(response)
                if response.status().as_u16() == 400 && attempt + 1 < bodies.len() =>
            {
                attempt += 1;
            }
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response.text().await.unwrap_or_default();
                return Err((status_code(status).to_string(), detail(body)));
            }
            Err(error) => {
                return Err((
                    network_code(&error).to_string(),
                    detail(error.to_string()),
                ));
            }
        }
    }
}

async fn run_stream(
    url: &str,
    api_key: &str,
    request: &StreamRequest,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
    channel: &Channel<StreamEvent>,
) -> Result<(), String> {
    let client = client(CONNECT_TIMEOUT)?;
    let parts = RequestParts {
        model: &request.model,
        messages: &request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        thinking: request.thinking.as_ref(),
        tools: request.tools.as_ref(),
        tool_choice: request.tool_choice.as_ref(),
    };
    let bodies = request_bodies(&parts, true);
    let original_had_tools = parts
        .tools
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false);

    let (mut response, used) = match post_with_degrade(&client, url, api_key, &bodies).await {
        Ok(result) => result,
        Err((code, detail)) => {
            send(channel, StreamEvent::Error { code, detail })?;
            return Ok(());
        }
    };
    let tools_dropped = original_had_tools && !body_has_tools(&bodies[used]);

    let mut parser = SseParser::default();
    let mut finish_reason: Option<String> = None;
    let mut calls: BTreeMap<usize, ToolCallAcc> = BTreeMap::new();

    loop {
        let chunk = tokio::select! {
            biased;
            _ = &mut cancel => {
                finish_stream(channel, &calls, finish_reason, true, tools_dropped)?;
                return Ok(());
            }
            read = tokio::time::timeout(IDLE_TIMEOUT, response.chunk()) => read,
        };

        let bytes = match chunk {
            Err(_) => {
                send(
                    channel,
                    StreamEvent::Error {
                        code: "timeout".to_string(),
                        detail: None,
                    },
                )?;
                return Ok(());
            }
            Ok(Err(error)) => {
                send(
                    channel,
                    StreamEvent::Error {
                        code: network_code(&error).to_string(),
                        detail: detail(error.to_string()),
                    },
                )?;
                return Ok(());
            }
            Ok(Ok(None)) => {
                finish_stream(channel, &calls, finish_reason, false, tools_dropped)?;
                return Ok(());
            }
            Ok(Ok(Some(bytes))) => bytes,
        };

        let payloads = match parser.push(&bytes) {
            Ok(payloads) => payloads,
            Err(code) => {
                send(channel, StreamEvent::Error { code, detail: None })?;
                return Ok(());
            }
        };

        for payload in payloads {
            let parsed = match parse_payload(&payload) {
                Ok(parsed) => parsed,
                Err(code) => {
                    send(
                        channel,
                        StreamEvent::Error {
                            code,
                            detail: detail(payload),
                        },
                    )?;
                    return Ok(());
                }
            };

            for item in parsed {
                match item {
                    Parsed::Delta(text) => send(channel, StreamEvent::Delta { text })?,
                    Parsed::Reasoning(text) => send(channel, StreamEvent::Reasoning { text })?,
                    Parsed::ToolCall(delta) => {
                        let entry = calls.entry(delta.index).or_default();
                        if let Some(id) = delta.id {
                            entry.id = id;
                        }
                        if let Some(name) = delta.name {
                            entry.name.push_str(&name);
                        }
                        if let Some(arguments) = delta.arguments {
                            entry.arguments.push_str(&arguments);
                        }
                    }
                    Parsed::Usage(usage) => send(
                        channel,
                        StreamEvent::Usage {
                            prompt_tokens: usage.prompt_tokens,
                            completion_tokens: usage.completion_tokens,
                            total_tokens: usage.total_tokens,
                            cache_hit_tokens: usage.cache_hit_tokens,
                            cache_miss_tokens: usage.cache_miss_tokens,
                        },
                    )?,
                    Parsed::Finish(reason) => {
                        finish_reason = Some(reason);
                    }
                    Parsed::Done => {
                        finish_stream(
                            channel,
                            &calls,
                            finish_reason,
                            false,
                            tools_dropped,
                        )?;
                        return Ok(());
                    }
                    Parsed::Error(message) => {
                        send(
                            channel,
                            StreamEvent::Error {
                                code: "server_error".to_string(),
                                detail: detail(message),
                            },
                        )?;
                        return Ok(());
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn agent_stream(
    state: tauri::State<'_, crate::agent::AgentState>,
    channel: Channel<StreamEvent>,
    request: StreamRequest,
) -> Result<(), String> {
    let api_key = match super::credentials::read_key(&request.provider_id, "llm") {
        Ok(Some(key)) => key,
        Ok(None) => {
            let _ = channel.send(StreamEvent::Error {
                code: "no_key".to_string(),
                detail: None,
            });
            return Ok(());
        }
        Err(_) => {
            let _ = channel.send(StreamEvent::Error {
                code: "storage_error".to_string(),
                detail: None,
            });
            return Ok(());
        }
    };

    let url = match endpoint(&request.base_url) {
        Ok(url) => url,
        Err(code) => {
            let _ = channel.send(StreamEvent::Error { code, detail: None });
            return Ok(());
        }
    };

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.insert(request.request_id.clone(), cancel_tx);
    }

    let result = run_stream(&url, &api_key, &request, cancel_rx, &channel).await;

    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.remove(&request.request_id);
    }
    result
}

fn abort_request(state: &crate::agent::AgentState, request_id: &str) -> bool {
    if let Ok(mut cancels) = state.cancels.lock() {
        if let Some(cancel) = cancels.remove(request_id) {
            let _ = cancel.send(());
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn agent_cancel(state: tauri::State<'_, crate::agent::AgentState>, request_id: String) -> bool {
    abort_request(&state, &request_id)
}

#[tauri::command]
pub async fn agent_complete(request: CompleteRequest) -> Result<CompleteResult, String> {
    let api_key = super::credentials::read_key(&request.provider_id, "llm")?
        .ok_or_else(|| "no_key".to_string())?;
    let url = endpoint(&request.base_url)?;
    let client = client(CONNECT_TIMEOUT)?;
    let parts = RequestParts {
        model: &request.model,
        messages: &request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        thinking: request.thinking.as_ref(),
        tools: request.tools.as_ref(),
        tool_choice: request.tool_choice.as_ref(),
    };
    let bodies = request_bodies(&parts, false);

    let (response, _) = post_with_degrade(&client, &url, &api_key, &bodies)
        .await
        .map_err(|(code, detail)| match detail {
            Some(detail) => format!("{code}: {detail}"),
            None => code,
        })?;

    let response = tokio::time::timeout(COMPLETE_TIMEOUT, response.json::<Value>())
        .await
        .map_err(|_| "timeout".to_string())?
        .map_err(|_| "bad_response".to_string())?;

    let message = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .cloned()
        .unwrap_or(Value::Null);

    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let reasoning = message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    let tool_calls = message.get("tool_calls").cloned().filter(|v| !v.is_null());
    let usage = response.get("usage").cloned().filter(|v| !v.is_null());

    Ok(CompleteResult {
        content,
        reasoning,
        tool_calls,
        usage,
    })
}

#[tauri::command]
pub async fn agent_list_models(
    provider_id: String,
    base_url: String,
) -> Result<Value, String> {
    let api_key = super::credentials::read_key(&provider_id, "llm")?
        .ok_or_else(|| "no_key".to_string())?;
    let url = models_endpoint(&base_url)?;
    let client = client(CONNECT_TIMEOUT)?.to_owned();
    let response = tokio::time::timeout(
        MODELS_TIMEOUT,
        client.get(&url).bearer_auth(&api_key).send(),
    )
    .await
    .map_err(|_| "timeout".to_string())?
    .map_err(|error| network_code(&error).to_string())?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let code = status_code(status);
        let tail = truncate(body.trim(), DETAIL_LIMIT);
        return Err(if tail.is_empty() {
            code.to_string()
        } else {
            format!("{code}: {tail}")
        });
    }

    response
        .json::<Value>()
        .await
        .map_err(|_| "bad_response".to_string())
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "bad_url".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("bad_url".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("bad_url".to_string());
    }

    #[cfg(windows)]
    {
        use windows::core::{w, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let _ = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("unsupported".to_string())
    }
}

#[tauri::command]
pub fn agent_open_url(url: String) -> Result<(), String> {
    open_external_url(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(sse: &str, parts: usize) -> Vec<Parsed> {
        let bytes = sse.as_bytes();
        let step = (bytes.len() / parts).max(1);
        let mut parser = SseParser::default();
        let mut parsed = Vec::new();
        for chunk in bytes.chunks(step) {
            for payload in parser.push(chunk).unwrap() {
                parsed.extend(parse_payload(&payload).unwrap());
            }
        }
        parsed
    }

    #[test]
    fn endpoint_appends_suffix_and_rejects_bad_urls() {
        assert_eq!(
            endpoint("https://gateway.example/v1").unwrap(),
            "https://gateway.example/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://gateway.example/v1/chat/completions/").unwrap(),
            "https://gateway.example/v1/chat/completions"
        );
        assert_eq!(
            endpoint("http://127.0.0.1:8000/v1").unwrap(),
            "http://127.0.0.1:8000/v1/chat/completions"
        );
        assert_eq!(endpoint("   ").unwrap_err(), "not_configured");
        assert_eq!(endpoint("ftp://x").unwrap_err(), "bad_url");
        assert_eq!(endpoint("http://example.com/v1").unwrap_err(), "bad_url");
        assert_eq!(
            endpoint("https://user:pass@example.com/v1").unwrap_err(),
            "bad_url"
        );
    }

    #[test]
    fn models_endpoint_is_derived_from_chat_base() {
        assert_eq!(
            models_endpoint("https://api.deepseek.com/v1").unwrap(),
            "https://api.deepseek.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.deepseek.com/v1/chat/completions").unwrap(),
            "https://api.deepseek.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.deepseek.com/v1/models").unwrap(),
            "https://api.deepseek.com/v1/models"
        );
    }

    #[test]
    fn reassembles_chinese_split_byte_by_byte() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":null}]}\n\n",
            "data: [DONE]\n\n"
        );
        assert_eq!(
            collect(sse, 1000),
            vec![Parsed::Delta("你好".to_string()), Parsed::Done]
        );
    }

    #[test]
    fn handles_crlf_and_split_frames() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"A\"},\"finish_reason\":null}]}\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"B\"},\"finish_reason\":\"stop\"}]}\r\n\r\n",
            "data: [DONE]\r\n\r\n"
        );
        let parsed = collect(sse, 7);
        assert!(parsed.contains(&Parsed::Delta("A".to_string())));
        assert!(parsed.contains(&Parsed::Delta("B".to_string())));
        assert!(parsed.contains(&Parsed::Finish("stop".to_string())));
        assert!(parsed.contains(&Parsed::Done));
    }

    #[test]
    fn keeps_usage_only_chunk() {
        let sse = concat!(
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,",
            "\"total_tokens\":12,\"prompt_cache_hit_tokens\":8,\"prompt_cache_miss_tokens\":2}}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = collect(sse, 3);
        let usage = parsed
            .iter()
            .find_map(|item| match item {
                Parsed::Usage(usage) => Some(usage.clone()),
                _ => None,
            })
            .expect("usage should survive an empty choices array");
        assert_eq!(usage.prompt_tokens, 10);
        assert_eq!(usage.cache_hit_tokens, Some(8));
        assert_eq!(usage.cache_miss_tokens, Some(2));
    }

    #[test]
    fn parses_reasoning_and_in_stream_errors() {
        let parsed = parse_payload(
            r#"{"choices":[{"delta":{"reasoning_content":"想一想"},"finish_reason":null}]}"#,
        )
        .unwrap();
        assert_eq!(parsed, vec![Parsed::Reasoning("想一想".to_string())]);

        let parsed = parse_payload(r#"{"error":{"message":"bad thing"}}"#).unwrap();
        assert_eq!(parsed, vec![Parsed::Error("bad thing".to_string())]);
    }

    #[test]
    fn accumulates_tool_call_deltas_by_index() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",",
            "\"type\":\"function\",\"function\":{\"name\":\"survey_read_table\",\"arguments\":\"{\\\"table\\\":\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,",
            "\"function\":{\"arguments\":\"\\\"traverse\\\",\\\"page\\\":1}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let parsed = collect(sse, 11);
        let mut calls: BTreeMap<usize, ToolCallAcc> = BTreeMap::new();
        for item in parsed {
            if let Parsed::ToolCall(delta) = item {
                let entry = calls.entry(delta.index).or_default();
                if let Some(id) = delta.id {
                    entry.id = id;
                }
                if let Some(name) = delta.name {
                    entry.name.push_str(&name);
                }
                if let Some(arguments) = delta.arguments {
                    entry.arguments.push_str(&arguments);
                }
            }
        }
        let completed = completed_calls(&calls);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].id, "call_1");
        assert_eq!(completed[0].function.name, "survey_read_table");
        assert_eq!(
            completed[0].function.arguments,
            r#"{"table":"traverse","page":1}"#
        );
    }

    #[test]
    fn degrades_in_the_documented_order() {
        let messages = vec![json!({ "role": "user", "content": "hi" })];
        let tools = json!([{ "type": "function", "function": { "name": "x" } }]);
        let thinking = json!({ "thinking": { "type": "enabled" }, "reasoning_effort": "high" });
        let parts = RequestParts {
            model: "deepseek-flash",
            messages: &messages,
            temperature: 1.0,
            max_tokens: 4096,
            thinking: Some(&thinking),
            tools: Some(&tools),
            tool_choice: None,
        };
        let bodies = request_bodies(&parts, true);
        assert!(bodies[0].get("temperature").is_some());
        assert!(bodies[1].get("temperature").is_none());
        assert!(bodies[2].get("stream_options").is_none());
        assert!(bodies[3].get("max_tokens").is_none());
        assert!(bodies[4].get("thinking").is_none());
        assert!(bodies[4].get("reasoning_effort").is_none());
        assert!(bodies[5].get("tools").is_none());
        assert!(!body_has_tools(&bodies[5]));
    }

    #[test]
    fn maps_http_status_to_stable_codes() {
        assert_eq!(status_code(401), "invalid_key");
        assert_eq!(status_code(402), "insufficient_balance");
        assert_eq!(status_code(404), "model_not_found");
        assert_eq!(status_code(429), "rate_limited");
        assert_eq!(status_code(503), "server_error");
    }

    #[tokio::test]
    async fn abort_signals_the_registered_request_once() {
        let state = crate::agent::AgentState::default();
        let (cancel, fired) = tokio::sync::oneshot::channel();
        state
            .cancels
            .lock()
            .unwrap()
            .insert("r1".to_string(), cancel);

        assert!(abort_request(&state, "r1"));
        assert!(fired.await.is_ok());
        assert!(!abort_request(&state, "r1"));
    }
}
