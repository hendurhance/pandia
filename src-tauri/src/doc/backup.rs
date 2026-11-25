use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static RECOVERY_OFFERED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub doc_id: String,
    pub original_path: Option<String>,
    pub display_name: Option<String>,
    pub updated_at: String,
    pub bytes: u64,
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

fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
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

fn info_path(dir: &Path, doc_id: &str) -> PathBuf {
    dir.join(format!("{}.json", sanitize_doc_id(doc_id)))
}

fn content_path(dir: &Path, doc_id: &str) -> PathBuf {
    dir.join(format!("{}.content", sanitize_doc_id(doc_id)))
}

pub fn write(
    app: &AppHandle,
    doc_id: &str,
    original_path: Option<String>,
    display_name: Option<String>,
    content: String,
) -> std::io::Result<()> {
    write_in(
        &backup_dir(app)?,
        doc_id,
        original_path,
        display_name,
        content,
    )
}

fn write_in(
    dir: &Path,
    doc_id: &str,
    original_path: Option<String>,
    display_name: Option<String>,
    content: String,
) -> std::io::Result<()> {
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default();
    write_private(&content_path(dir, doc_id), &content)?;
    let info = BackupInfo {
        doc_id: doc_id.to_string(),
        original_path,
        display_name,
        updated_at,
        bytes: content.len() as u64,
    };
    let json = serde_json::to_string(&info).map_err(|e| std::io::Error::other(e.to_string()))?;
    write_private(&info_path(dir, doc_id), &json)
}

pub fn read_content(app: &AppHandle, doc_id: &str) -> std::io::Result<String> {
    read_content_in(&backup_dir(app)?, doc_id)
}

fn read_content_in(dir: &Path, doc_id: &str) -> std::io::Result<String> {
    std::fs::read_to_string(content_path(dir, doc_id))
}

pub fn clear(app: &AppHandle, doc_id: &str) -> std::io::Result<()> {
    clear_in(&backup_dir(app)?, doc_id)
}

fn clear_in(dir: &Path, doc_id: &str) -> std::io::Result<()> {
    for path in [info_path(dir, doc_id), content_path(dir, doc_id)] {
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    Ok(())
}

pub fn scan_once(app: &AppHandle) -> std::io::Result<Vec<BackupInfo>> {
    if RECOVERY_OFFERED.swap(true, Ordering::SeqCst) {
        return Ok(Vec::new());
    }
    scan_in(&backup_dir(app)?)
}

fn scan_in(dir: &Path) -> std::io::Result<Vec<BackupInfo>> {
    let mut found = Vec::new();
    let mut unusable = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        match path.extension().and_then(|s| s.to_str()) {
            Some("json") => {
                let info = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|text| serde_json::from_str::<BackupInfo>(&text).ok())
                    .filter(|info| content_path(dir, &info.doc_id).is_file());
                match info {
                    Some(info) => found.push(info),
                    None => unusable.push(stem),
                }
            }
            Some("content") if !info_path(dir, &stem).is_file() => unusable.push(stem),
            _ => {}
        }
    }
    let (kept, stale) = dedupe_newest_first(found);
    for doc_id in unusable.iter().chain(&stale) {
        let _ = clear_in(dir, doc_id);
    }
    Ok(kept)
}

fn dedupe_newest_first(mut records: Vec<BackupInfo>) -> (Vec<BackupInfo>, Vec<String>) {
    records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut kept = Vec::with_capacity(records.len());
    let mut stale = Vec::new();
    for rec in records {
        let key = rec
            .original_path
            .clone()
            .filter(|p| Path::new(p).is_absolute())
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

    fn temp_dir(name: &str) -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("pandia-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = private_dir(root.join("backups")).unwrap();
        (root, dir)
    }

    #[test]
    fn a_code_view_backup_keeps_the_uncommitted_text_as_typed() {
        let (root, dir) = temp_dir("text");
        let typed = "{\n  \"a\": 2,\n";

        write_in(
            &dir,
            "7",
            Some("/w/c.json".into()),
            Some("c.json".into()),
            typed.into(),
        )
        .unwrap();

        assert_eq!(read_content_in(&dir, "7").unwrap(), typed);
        #[cfg(unix)]
        for file in ["7.json", "7.content"] {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(file))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "{file}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_scan_reads_only_the_small_records_and_never_the_document_text() {
        let (root, dir) = temp_dir("scan");
        let big = format!("[{}]", "1,".repeat(500_000) + "1");
        write_in(
            &dir,
            "7",
            Some("/w/big.json".into()),
            Some("big.json".into()),
            big.clone(),
        )
        .unwrap();

        let found = scan_in(&dir).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].doc_id, "7");
        assert_eq!(found[0].original_path.as_deref(), Some("/w/big.json"));
        assert_eq!(found[0].bytes, big.len() as u64);
        assert!(std::fs::metadata(dir.join("7.json")).unwrap().len() < 300);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn clearing_a_backup_removes_its_record_and_its_text() {
        let (root, dir) = temp_dir("clear");
        write_in(&dir, "7", None, Some("draft".into()), "{}".into()).unwrap();
        clear_in(&dir, "7").unwrap();
        clear_in(&dir, "7").unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_scan_removes_old_format_and_half_written_backups() {
        let (root, dir) = temp_dir("stale");
        write_in(&dir, "ok", None, Some("kept".into()), "{}".into()).unwrap();
        std::fs::write(
            dir.join("old.json"),
            r#"{"docId":"old","originalPath":null,"displayName":null,"updatedAt":"1","content":"{}"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("orphan.content"), "{}").unwrap();
        write_in(&dir, "gone", None, None, "{}".into()).unwrap();
        std::fs::remove_file(dir.join("gone.content")).unwrap();

        let found: Vec<String> = scan_in(&dir)
            .unwrap()
            .into_iter()
            .map(|b| b.doc_id)
            .collect();
        assert_eq!(found, ["ok"]);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["ok.content", "ok.json"]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn rec(doc_id: &str, path: Option<&str>, name: Option<&str>, updated_at: &str) -> BackupInfo {
        BackupInfo {
            doc_id: doc_id.into(),
            original_path: path.map(Into::into),
            display_name: name.map(Into::into),
            updated_at: updated_at.into(),
            bytes: 0,
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
