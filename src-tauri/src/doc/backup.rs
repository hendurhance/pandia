
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static RECOVERY_OFFERED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub doc_id: String,
    pub original_path: Option<String>,
    pub display_name: Option<String>,
    pub updated_at: String,
    pub content: String,
}

fn backup_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let dir = base.join("backups");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn backup_path(app: &AppHandle, doc_id: &str) -> std::io::Result<PathBuf> {
    let safe: String = doc_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    Ok(backup_dir(app)?.join(format!("{}.json", safe)))
}

pub fn write(
    app: &AppHandle,
    doc_id: &str,
    original_path: Option<String>,
    display_name: Option<String>,
    content: String,
) -> std::io::Result<()> {
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();
    let rec = BackupRecord {
        doc_id: doc_id.to_string(),
        original_path,
        display_name,
        updated_at,
        content,
    };
    let json = serde_json::to_string(&rec)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    std::fs::write(backup_path(app, doc_id)?, json)
}

pub fn clear(app: &AppHandle, doc_id: &str) -> std::io::Result<()> {
    let path = backup_path(app, doc_id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn scan_once(app: &AppHandle) -> std::io::Result<Vec<BackupRecord>> {
    if RECOVERY_OFFERED.swap(true, Ordering::SeqCst) {
        return Ok(Vec::new());
    }
    scan(app)
}

pub fn scan(app: &AppHandle) -> std::io::Result<Vec<BackupRecord>> {
    let dir = backup_dir(app)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Ok(rec) = serde_json::from_str::<BackupRecord>(&text) {
            out.push(rec);
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut deduped: Vec<BackupRecord> = Vec::with_capacity(out.len());
    for rec in out.into_iter() {
        let key = rec
            .original_path
            .clone()
            .or_else(|| rec.display_name.clone())
            .unwrap_or_else(|| rec.doc_id.clone());
        if seen.insert(key) {
            deduped.push(rec);
        } else {
            let _ = clear(app, &rec.doc_id);
        }
    }
    Ok(deduped)
}
