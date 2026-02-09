use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use crate::http_client::{HttpMethod, HttpRequest, HttpResponse};

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestPayload {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout: Option<u64>,
}

#[tauri::command]
pub async fn send_http_request(payload: RequestPayload) -> Result<HttpResponse, String> {
    let method = match payload.method.to_uppercase().as_str() {
        "GET" => HttpMethod::GET,
        "POST" => HttpMethod::POST,
        "PUT" => HttpMethod::PUT,
        "DELETE" => HttpMethod::DELETE,
        "PATCH" => HttpMethod::PATCH,
        "HEAD" => HttpMethod::HEAD,
        "OPTIONS" => HttpMethod::OPTIONS,
        _ => return Err(format!("Unsupported HTTP method: {}", payload.method)),
    };

    let request = HttpRequest {
        method,
        url: payload.url,
        headers: payload.headers.unwrap_or_default(),
        body: payload.body,
        timeout: payload.timeout,
    };

    crate::http_client::execute_request(request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn initialize_database() -> Result<String, String> {
    // Database initialization SQL
    let init_sql = r#"
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            parent_folder_id TEXT,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY,
            collection_id TEXT,
            folder_id TEXT,
            name TEXT NOT NULL,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            headers TEXT,
            body TEXT,
            auth TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS environments (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            variables TEXT NOT NULL,
            is_active INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            request_id TEXT,
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            headers TEXT,
            body TEXT,
            response_status INTEGER,
            response_headers TEXT,
            response_body TEXT,
            response_time INTEGER,
            executed_at INTEGER NOT NULL,
            FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL
        );
    "#;

    Ok("Database initialized successfully".to_string())
}
