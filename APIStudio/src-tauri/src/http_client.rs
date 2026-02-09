use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
    HEAD,
    OPTIONS,
}

impl HttpMethod {
    pub fn as_str(&self) -> &str {
        match self {
            HttpMethod::GET => "GET",
            HttpMethod::POST => "POST",
            HttpMethod::PUT => "PUT",
            HttpMethod::DELETE => "DELETE",
            HttpMethod::PATCH => "PATCH",
            HttpMethod::HEAD => "HEAD",
            HttpMethod::OPTIONS => "OPTIONS",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub response_time: u128, // in milliseconds
    pub size: usize,          // in bytes
}

pub async fn execute_request(request: HttpRequest) -> Result<HttpResponse, Box<dyn std::error::Error>> {
    let start_time = Instant::now();

    // Build the HTTP client
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(request.timeout.unwrap_or(30)))
        .build()?;

    // Convert headers
    let mut header_map = HeaderMap::new();
    for (key, value) in &request.headers {
        if let (Ok(name), Ok(val)) = (HeaderName::from_str(key), HeaderValue::from_str(value)) {
            header_map.insert(name, val);
        }
    }

    // Build the request
    let mut req_builder = match request.method {
        HttpMethod::GET => client.get(&request.url),
        HttpMethod::POST => client.post(&request.url),
        HttpMethod::PUT => client.put(&request.url),
        HttpMethod::DELETE => client.delete(&request.url),
        HttpMethod::PATCH => client.patch(&request.url),
        HttpMethod::HEAD => client.head(&request.url),
        HttpMethod::OPTIONS => {
            client.request(reqwest::Method::OPTIONS, &request.url)
        }
    };

    req_builder = req_builder.headers(header_map);

    // Add body if present
    if let Some(body) = &request.body {
        req_builder = req_builder.body(body.clone());
    }

    // Execute the request
    let response = req_builder.send().await?;

    // Extract response data
    let status = response.status().as_u16();
    let status_text = response.status().to_string();

    // Extract response headers
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(val_str) = value.to_str() {
            response_headers.insert(key.to_string(), val_str.to_string());
        }
    }

    // Get response body
    let body_bytes = response.bytes().await?;
    let body_size = body_bytes.len();
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    let response_time = start_time.elapsed().as_millis();

    Ok(HttpResponse {
        status,
        status_text,
        headers: response_headers,
        body,
        response_time,
        size: body_size,
    })
}
