use std::io::Read;
use std::path::Path as FsPath;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sonic_rs::FastStr;

use crate::doc::detect::{detect_and_convert, DetectKind};
use crate::doc::diagnose::{diagnose, Diagnosis};
use crate::doc::document::Document;
use crate::doc::mapped::MappedText;
use crate::doc::progress::{OpenPhase, Reporter, TICK_BYTES};
use crate::doc::repair::repair;
use crate::doc::tier::{Tier, MAX_DOC_BYTES};
use crate::doc::types::{BigFileProblem, DocError, DocResult, FileOp};

#[derive(Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    pub repair: bool,
}

#[derive(Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenNotes {
    pub converted_from: Option<DetectKind>,
    pub repairs: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenFailure {
    pub detail: String,
    pub too_large_to_fix: bool,
    pub diagnosis: Diagnosis,
}

pub enum Loaded {
    Opened(Box<Document>, OpenNotes),
    Failed(OpenFailure),
}

pub fn load_file(
    path: &FsPath,
    name: Option<String>,
    file_path: Option<String>,
    options: OpenOptions,
    fix_limit: u64,
    progress: Reporter,
) -> DocResult<Loaded> {
    let fail = |e| DocError::file(FileOp::Open, path, e);
    let size = std::fs::metadata(path).map_err(fail)?.len();
    let shown = || {
        name.clone()
            .unwrap_or_else(|| path.to_string_lossy().into_owned())
    };
    match Tier::admit(size) {
        None => Err(DocError::BigFile(BigFileProblem::TooLarge {
            file: shown(),
            actual: size,
            limit: MAX_DOC_BYTES,
        })),
        Some(Tier::Mapped) => load_mapped(path, shown(), name, file_path, progress),
        Some(_) => {
            let text = read_reporting(path, size, progress).map_err(fail)?;
            load_text(text, name, file_path, options, fix_limit, progress)
        }
    }
}

fn read_reporting(path: &FsPath, size: u64, progress: Reporter) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(size as usize);
    while (&mut file)
        .take(TICK_BYTES as u64)
        .read_to_end(&mut bytes)?
        > 0
    {
        progress.step(OpenPhase::Reading, bytes.len(), size as usize);
    }
    String::from_utf8(bytes).map_err(|_| std::io::ErrorKind::InvalidData.into())
}

fn load_mapped(
    path: &FsPath,
    shown: String,
    name: Option<String>,
    file_path: Option<String>,
    progress: Reporter,
) -> DocResult<Loaded> {
    let (text, scanned) = MappedText::open_scanned(path, shown, progress)?;
    let text = Arc::new(text);
    match Document::from_mapped_reporting(Arc::clone(&text), scanned, name, progress) {
        Ok(mut doc) => {
            doc.file_path = file_path;
            Ok(Loaded::Opened(Box::new(doc), OpenNotes::default()))
        }
        Err(DocError::Parse(detail)) => Ok(Loaded::Failed(OpenFailure {
            detail,
            too_large_to_fix: true,
            diagnosis: diagnose(text.as_str(), false),
        })),
        Err(e) => Err(e),
    }
}

pub fn load_text(
    text: String,
    name: Option<String>,
    file_path: Option<String>,
    options: OpenOptions,
    fix_limit: u64,
    progress: Reporter,
) -> DocResult<Loaded> {
    let text = FastStr::from_string(text);
    let detail = match Document::from_source_reporting(text.clone(), name.clone(), progress) {
        Ok(mut doc) => {
            doc.file_path = file_path;
            return Ok(Loaded::Opened(Box::new(doc), OpenNotes::default()));
        }
        Err(DocError::Parse(detail)) => detail,
        Err(e) => return Err(e),
    };

    let fixable = text.len() as u64 <= fix_limit;
    let starts_like_json = matches!(
        text.trim_start_matches('\u{feff}')
            .trim_start()
            .chars()
            .next(),
        Some('{' | '[')
    );
    if fixable && !starts_like_json {
        let detected = detect_and_convert(&text);
        if detected.error.is_none()
            && !matches!(detected.kind, DetectKind::Json | DetectKind::Unknown)
        {
            let doc =
                Document::from_text(&detected.json, Some(copy_name(name.as_deref(), "json")))?;
            let notes = OpenNotes {
                converted_from: Some(detected.kind),
                ..OpenNotes::default()
            };
            return Ok(Loaded::Opened(Box::new(doc), notes));
        }
    }
    if fixable && options.repair {
        if let Some(repaired) = repair(&text) {
            let name = copy_name(name.as_deref(), "repaired.json");
            if let Ok(doc) = Document::from_text(&repaired.json, Some(name)) {
                let notes = OpenNotes {
                    repairs: repaired.notes,
                    ..OpenNotes::default()
                };
                return Ok(Loaded::Opened(Box::new(doc), notes));
            }
        }
    }
    Ok(Loaded::Failed(OpenFailure {
        detail,
        too_large_to_fix: !fixable,
        diagnosis: diagnose(&text, fixable),
    }))
}

pub fn copy_name(name: Option<&str>, suffix: &str) -> String {
    let original = name.map(std::path::Path::new);
    let stem = original
        .and_then(|p| p.file_stem())
        .map_or_else(|| "untitled".into(), |s| s.to_string_lossy().into_owned());
    let copy = format!("{stem}.{suffix}");
    match original
        .and_then(|p| p.parent())
        .filter(|d| d.is_absolute())
    {
        Some(folder) => folder.join(copy).to_string_lossy().into_owned(),
        None => copy,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::progress::OpenProgress;
    use crate::doc::types::Path;
    use serde_json::json;

    fn open(text: &str) -> (serde_json::Value, OpenNotes) {
        let options = OpenOptions { repair: true };
        match load_text(
            text.into(),
            Some("x.json".into()),
            None,
            options,
            1 << 20,
            Reporter::NONE,
        )
        .unwrap()
        {
            Loaded::Opened(doc, notes) => (doc.get_value(&Path::root()).unwrap(), notes),
            Loaded::Failed(f) => panic!("{text:?} failed to open: {}", f.detail),
        }
    }

    #[test]
    fn multi_line_jsonp_repairs_instead_of_converting_from_csv() {
        for text in [
            "callback([{\"id\":1,\"name\":\"a\"},\n{\"id\":2,\"name\":\"b\"}]);",
            "({\"id\":1,\"name\":\"a\"},\n{\"id\":2,\"name\":\"b\"})",
        ] {
            let (v, notes) = open(text);
            assert_eq!(notes.converted_from, None, "{text:?}");
            assert_eq!(
                v,
                json!([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]),
                "{text:?}"
            );
        }
    }

    #[test]
    fn a_mapped_file_opens_attached_to_its_file_or_fails_without_a_fix() {
        use crate::doc::mapped::TempFile;
        let file = TempFile::new("ok.json", r#"{"a": [1, 2]}"#);
        let path = file.0.to_string_lossy().into_owned();
        let shown = path.clone();
        match load_mapped(
            &file.0,
            shown,
            Some(path.clone()),
            Some(path.clone()),
            Reporter::NONE,
        )
        .unwrap()
        {
            Loaded::Opened(doc, notes) => {
                assert_eq!(doc.summary().tier, Tier::Mapped);
                assert!(doc.summary().file_backed);
                assert!(notes.repairs.is_empty() && notes.converted_from.is_none());
            }
            Loaded::Failed(f) => panic!("expected to open: {}", f.detail),
        }

        let broken = TempFile::new("cut.json", r#"{"a": [1, 2"#);
        let shown = broken.0.to_string_lossy().into_owned();
        let Loaded::Failed(f) = load_mapped(&broken.0, shown, None, None, Reporter::NONE).unwrap()
        else {
            panic!("broken JSON must not open");
        };
        assert!(f.too_large_to_fix);
        assert!(f.diagnosis.fix.is_none(), "no repaired copy is offered");
        assert!(f.diagnosis.excerpt.is_some());
    }

    fn phases_while_opening(open: impl FnOnce(Reporter) -> Loaded) -> Vec<OpenProgress> {
        let seen = std::sync::Mutex::new(Vec::new());
        let report = |p| seen.lock().unwrap().push(p);
        assert!(matches!(open(Reporter::new(&report)), Loaded::Opened(..)));
        seen.into_inner().unwrap()
    }

    fn assert_phases_finish_in_order(seen: &[OpenProgress], want: &[OpenPhase]) {
        let mut order: Vec<OpenPhase> = seen.iter().map(|p| p.phase).collect();
        order.dedup();
        assert_eq!(order, want);
        for phase in order {
            let steps: Vec<_> = seen.iter().filter(|p| p.phase == phase).collect();
            assert!(steps.windows(2).all(|w| w[0].done <= w[1].done));
            let last = steps.last().unwrap();
            assert_eq!(last.done, last.total, "{phase:?} ends complete");
        }
    }

    #[test]
    fn opening_a_big_file_reports_each_phase_in_order_and_finishes_each() {
        use crate::doc::mapped::TempFile;
        let rows = vec![r#"{"id":1,"name":"Ada"}"#; 600_000].join(",");
        let file = TempFile::new("big.json", &format!("[{rows}]"));
        assert!(file.0.metadata().unwrap().len() > 10_000_000, "lazy tier");

        let in_memory = phases_while_opening(|r| {
            load_file(&file.0, None, None, OpenOptions::default(), 0, r).unwrap()
        });
        assert_phases_finish_in_order(&in_memory, &[OpenPhase::Reading, OpenPhase::Checking]);

        let shown = file.0.to_string_lossy().into_owned();
        let mapped = phases_while_opening(|r| load_mapped(&file.0, shown, None, None, r).unwrap());
        assert_phases_finish_in_order(&mapped, &[OpenPhase::Checking]);
    }

    #[test]
    #[cfg(unix)]
    fn a_file_over_the_ceiling_is_refused_by_name_before_it_is_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("pandia-ceiling-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("huge.json");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_DOC_BYTES + 1)
            .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();

        let shown = Some("huge.json".to_string());
        let refused = load_file(
            &path,
            shown,
            None,
            OpenOptions::default(),
            0,
            Reporter::NONE,
        );
        std::fs::remove_dir_all(&dir).unwrap();
        let Err(DocError::BigFile(problem)) = refused else {
            panic!("expected a big-file refusal");
        };
        assert_eq!(
            problem,
            BigFileProblem::TooLarge {
                file: "huge.json".into(),
                actual: MAX_DOC_BYTES + 1,
                limit: MAX_DOC_BYTES,
            }
        );
    }

    #[test]
    fn csv_still_converts_when_repair_is_on() {
        for text in ["id,name\n1,a\n2,b\n", "\"id\",\"name\"\n1,\"a\"\n2,\"b\"\n"] {
            let (v, notes) = open(text);
            assert_eq!(notes.converted_from, Some(DetectKind::Csv), "{text:?}");
            assert_eq!(v, json!([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]));
        }
        let (_, notes) = open("name: Ada\ntags:\n  - x\n");
        assert_eq!(notes.converted_from, Some(DetectKind::Yaml));
    }
}
