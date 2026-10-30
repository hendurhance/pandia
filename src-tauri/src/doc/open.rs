use serde::{Deserialize, Serialize};
use sonic_rs::FastStr;

use crate::doc::detect::{detect_and_convert, DetectKind};
use crate::doc::diagnose::{diagnose, Diagnosis};
use crate::doc::document::Document;
use crate::doc::repair::repair;
use crate::doc::types::{DocError, DocResult};

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

pub fn load_text(
    text: String,
    name: Option<String>,
    file_path: Option<String>,
    options: OpenOptions,
    fix_limit: u64,
) -> DocResult<Loaded> {
    let text = FastStr::from_string(text);
    let detail = match Document::from_source(text.clone(), name.clone()) {
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
    let stem = name
        .and_then(|n| std::path::Path::new(n).file_stem())
        .map_or_else(|| "untitled".into(), |s| s.to_string_lossy().into_owned());
    format!("{stem}.{suffix}")
}
