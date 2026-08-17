use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownDocument {
    path: String,
    file_name: String,
    content: String,
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            lowered == "md" || lowered == "markdown" || lowered == "mdown" || lowered == "mkd"
        })
        .unwrap_or(false)
}

fn read_markdown(path: &Path) -> Result<MarkdownDocument, String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve file path: {error}"))?;

    if !is_markdown_file(&canonical_path) {
        return Err("Only markdown files are supported.".to_string());
    }

    let content = fs::read_to_string(&canonical_path)
        .map_err(|error| format!("Failed to read markdown file: {error}"))?;
    let file_name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string();

    Ok(MarkdownDocument {
        path: canonical_path.to_string_lossy().to_string(),
        file_name,
        content,
    })
}

fn get_launch_path() -> Option<PathBuf> {
    env::args()
        .skip(1)
        .filter(|value| !value.starts_with('-'))
        .map(PathBuf::from)
        .find(|path| path.exists() && is_markdown_file(path))
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownDocument, String> {
    read_markdown(Path::new(&path))
}

#[tauri::command]
fn get_launch_markdown() -> Result<Option<MarkdownDocument>, String> {
    if let Some(path) = get_launch_path() {
        return read_markdown(&path).map(Some);
    }

    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            get_launch_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
