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
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let dir = base.join("backups");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn sanitize_doc_id(doc_id: &str) -> String {
    doc_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect()
}

fn backup_path(app: &AppHandle, doc_id: &str) -> std::io::Result<PathBuf> {
    Ok(backup_dir(app)?.join(format!("{}.json", sanitize_doc_id(doc_id))))
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
    let json = serde_json::to_string(&rec).map_err(|e| std::io::Error::other(e.to_string()))?;
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
    let (kept, stale) = dedupe_newest_first(out);
    for doc_id in stale {
        let _ = clear(app, &doc_id);
    }
    Ok(kept)
}

fn dedupe_newest_first(mut records: Vec<BackupRecord>) -> (Vec<BackupRecord>, Vec<String>) {
    records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut kept = Vec::with_capacity(records.len());
    let mut stale = Vec::new();
    for rec in records {
        let key = rec
            .original_path
            .clone()
            .or_else(|| rec.display_name.clone())
            .unwrap_or_else(|| rec.doc_id.clone());
        if seen.insert(key) {
            kept.push(rec);
        } else {
            stale.push(rec.doc_id);
        }
    }
    (kept, stale)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(doc_id: &str, path: Option<&str>, name: Option<&str>, updated_at: &str) -> BackupRecord {
        BackupRecord {
            doc_id: doc_id.into(),
            original_path: path.map(Into::into),
            display_name: name.map(Into::into),
            updated_at: updated_at.into(),
            content: String::new(),
        }
    }

    #[test]
    fn sanitize_strips_separators_and_traversal() {
        assert_eq!(sanitize_doc_id("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_doc_id("a/b\\c"), "abc");
        assert_eq!(sanitize_doc_id("doc-123"), "doc-123");
        assert_eq!(sanitize_doc_id("..."), "");
    }

    #[test]
    fn dedupe_keeps_newest_per_path() {
        let recs = vec![
            rec("old", Some("/a.json"), None, "1000"),
            rec("new", Some("/a.json"), None, "2000"),
            rec("other", Some("/b.json"), None, "1500"),
        ];
        let (kept, stale) = dedupe_newest_first(recs);
        let kept_ids: Vec<_> = kept.iter().map(|r| r.doc_id.as_str()).collect();
        assert_eq!(kept_ids, vec!["new", "other"]);
        assert_eq!(stale, vec!["old".to_string()]);
    }

    #[test]
    fn dedupe_falls_back_to_display_name_then_doc_id() {
        let recs = vec![
            rec("d1", None, Some("draft"), "2000"),
            rec("d2", None, Some("draft"), "1000"),
            rec("d3", None, None, "1500"),
        ];
        let (kept, stale) = dedupe_newest_first(recs);
        let kept_ids: Vec<_> = kept.iter().map(|r| r.doc_id.as_str()).collect();
        assert_eq!(kept_ids, vec!["d1", "d3"]);
        assert_eq!(stale, vec!["d2".to_string()]);
    }
}
