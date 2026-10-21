use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static RECOVERY_OFFERED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
    private_dir(base.join("backups"))
}

fn private_dir(dir: PathBuf) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir)
}

fn write_private(path: &std::path::Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    super::atomic::write_atomic(path, |w| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            w.get_ref()
                .set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        w.write_all(text.as_bytes())
    })
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
    write_private(&backup_path(app, doc_id)?, &json)
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
            .filter(|p| std::path::Path::new(p).is_absolute())
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

    #[test]
    #[cfg(unix)]
    fn backups_are_readable_by_their_owner_only_even_from_older_versions() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        let root = std::env::temp_dir().join(format!("pandia-backup-perm-{}", std::process::id()));
        let dir = root.join("backups");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let old = dir.join("old.json");
        std::fs::write(&old, "{}").unwrap();
        std::fs::set_permissions(&old, std::fs::Permissions::from_mode(0o644)).unwrap();

        let dir = private_dir(dir).unwrap();
        write_private(&old, "{}").unwrap();
        let new = dir.join("new.json");
        write_private(&new, "{}").unwrap();

        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&old), 0o600);
        assert_eq!(mode(&new), 0o600);
        std::fs::remove_dir_all(&root).unwrap();
    }

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
    fn documents_without_a_file_are_never_merged() {
        let recs = vec![
            rec("d1", Some("pasted.json"), Some("pasted.json"), "2000"),
            rec("d2", Some("pasted.json"), Some("pasted.json"), "1000"),
            rec("d3", None, Some("draft"), "1500"),
            rec("d4", None, Some("draft"), "1400"),
        ];
        let (kept, stale) = dedupe_newest_first(recs);
        let kept_ids: Vec<_> = kept.iter().map(|r| r.doc_id.as_str()).collect();
        assert_eq!(kept_ids, vec!["d1", "d3", "d4", "d2"]);
        assert!(stale.is_empty());
    }
}
