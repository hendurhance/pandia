use std::ops::Range;

use serde_json::Value;

use super::export::ExportError;
use super::jobs::CancelFlag;
use super::search::{SearchHit, SearchOptions};
use super::typegen::TypegenLang;
use super::types::{DocResult, NodeKind, NodeView, Path};

pub(crate) trait DocumentBackend {
    fn root_kind_and_count(&self) -> (NodeKind, Option<u32>);
    fn slice(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<NodeView>>;
    fn kind_at(&self, path: &Path) -> DocResult<(NodeKind, Option<u32>)>;
    fn child_count_at(&self, path: &Path) -> DocResult<Option<u32>>;
    fn get_value(&self, path: &Path) -> DocResult<Value>;
    fn column_cells(&self, path: &Path, key: &str) -> DocResult<Vec<Option<Value>>>;
    fn column_text_lower(&self, path: &Path, key: &str) -> DocResult<Vec<Option<String>>>;
    fn search(&self, opts: &SearchOptions, cancel: &CancelFlag) -> Vec<SearchHit>;
    fn generate_types(&self, lang: TypegenLang, type_name: &str) -> DocResult<String>;
    fn hash_into(&self, hasher: &mut blake3::Hasher) -> Result<(), ()>;
    fn serialize_pretty(&self) -> DocResult<String>;
    fn serialize_ndjson(&self) -> Option<String>;
    fn write_json(&self, pretty: bool, w: &mut dyn std::io::Write) -> Result<(), ExportError>;
    fn preview_json(&self, pretty: bool, max_bytes: usize) -> DocResult<(String, bool)>;
    fn borrowed_root(&self) -> Option<&Value>;
}

#[cfg(test)]
mod conformance {
    use super::super::lazy::LazyDoc;
    use super::*;
    use crate::doc::types::PathSegment;

    const FIXTURE: &str = r#"{
        "users": [
            {"id": 1075283027435454464, "name": "ada", "active": true, "score": 1.50},
            {"id": 2, "name": "grace", "active": false, "score": null},
            {"id": 3, "name": "ε-unicode", "active": true, "score": 0.1}
        ],
        "empty_obj": {},
        "empty_arr": [],
        "note": "plain string",
        "big": 12345678901234567890
    }"#;

    fn backends() -> (Value, LazyDoc) {
        let eager: Value = serde_json::from_str(FIXTURE).expect("fixture parses");
        let lazy = LazyDoc::new(FIXTURE).expect("fixture parses lazily");
        (eager, lazy)
    }

    fn p(segs: &[PathSegment]) -> Path {
        Path(segs.to_vec())
    }
    fn k(s: &str) -> PathSegment {
        PathSegment::Key(s.into())
    }
    fn i(n: u32) -> PathSegment {
        PathSegment::Index(n)
    }

    fn paths() -> Vec<Path> {
        vec![
            p(&[]),
            p(&[k("users")]),
            p(&[k("users"), i(0)]),
            p(&[k("users"), i(0), k("id")]),
            p(&[k("users"), i(2), k("name")]),
            p(&[k("empty_obj")]),
            p(&[k("empty_arr")]),
            p(&[k("note")]),
            p(&[k("big")]),
        ]
    }

    #[test]
    fn root_kind_and_count_agree() {
        let (eager, lazy) = backends();
        assert_eq!(
            DocumentBackend::root_kind_and_count(&eager),
            DocumentBackend::root_kind_and_count(&lazy)
        );
    }

    #[test]
    fn slices_are_byte_identical() {
        let (eager, lazy) = backends();
        for path in paths() {
            for range in [0..0, 0..2, 0..100, 1..3, 5..10] {
                let e = DocumentBackend::slice(&eager, &path, range.clone());
                let l = DocumentBackend::slice(&lazy, &path, range.clone());
                match (e, l) {
                    (Ok(e), Ok(l)) => assert_eq!(e, l, "slice {path} {range:?}"),
                    (Err(_), Err(_)) => {}
                    (e, l) => panic!("slice {path} {range:?}: eager={e:?} lazy={l:?}"),
                }
            }
        }
    }

    #[test]
    fn kinds_counts_and_values_agree() {
        let (eager, lazy) = backends();
        for path in paths() {
            assert_eq!(
                DocumentBackend::kind_at(&eager, &path).ok(),
                DocumentBackend::kind_at(&lazy, &path).ok(),
                "kind_at {path}"
            );
            assert_eq!(
                DocumentBackend::child_count_at(&eager, &path).ok(),
                DocumentBackend::child_count_at(&lazy, &path).ok(),
                "child_count_at {path}"
            );
            assert_eq!(
                DocumentBackend::get_value(&eager, &path).ok(),
                DocumentBackend::get_value(&lazy, &path).ok(),
                "get_value {path}"
            );
        }
    }

    #[test]
    fn missing_paths_fail_on_both() {
        let (eager, lazy) = backends();
        let missing = p(&[k("users"), i(9)]);
        assert!(DocumentBackend::get_value(&eager, &missing).is_err());
        assert!(DocumentBackend::get_value(&lazy, &missing).is_err());
    }

    #[test]
    fn column_reads_agree() {
        let (eager, lazy) = backends();
        let users = p(&[k("users")]);
        for key in ["id", "name", "active", "score", "nope"] {
            assert_eq!(
                DocumentBackend::column_cells(&eager, &users, key).ok(),
                DocumentBackend::column_cells(&lazy, &users, key).ok(),
                "column_cells {key}"
            );
            assert_eq!(
                DocumentBackend::column_text_lower(&eager, &users, key).ok(),
                DocumentBackend::column_text_lower(&lazy, &users, key).ok(),
                "column_text_lower {key}"
            );
        }
    }

    #[test]
    fn search_hits_agree() {
        let (eager, lazy) = backends();
        for query in ["ada", "name", "unicode", "zzz-no-hit"] {
            let opts = SearchOptions {
                query: query.into(),
                case_sensitive: false,
                max_results: None,
            };
            let e = DocumentBackend::search(&eager, &opts, &CancelFlag::never());
            let l = DocumentBackend::search(&lazy, &opts, &CancelFlag::never());
            assert_eq!(e, l, "search {query}");
        }
    }
}
