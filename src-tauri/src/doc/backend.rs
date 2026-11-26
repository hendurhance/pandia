use std::ops::Range;

use serde_json::Value;

use super::cell::Cell;
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
    fn rows(&self, path: &Path, range: Range<u32>) -> DocResult<Vec<Value>>;
    fn column_cells(&self, path: &Path, key: &str) -> DocResult<Vec<Option<Value>>>;
    fn column_keys(&self, path: &Path, key: &str) -> DocResult<Vec<Cell<'_>>>;
    fn column_text(&self, path: &Path, key: &str) -> DocResult<Vec<Option<String>>>;
    fn for_each_row_field(
        &self,
        path: &Path,
        cancel: &CancelFlag,
        f: &mut dyn FnMut(&str, NodeKind),
    ) -> DocResult<u32>;
    fn search(
        &self,
        opts: &SearchOptions,
        cancel: &CancelFlag,
        report: &mut dyn FnMut(&[SearchHit], u64),
    ) -> Vec<SearchHit>;
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
            {"id": 1075283027435454464, "name": "ada", "active": true, "score": 1.50, "extra": {"a": [1]}},
            {"id": 2, "name": "grace", "active": false, "score": null, "extra": "say \"hi\""},
            {"id": 3, "name": "ε-unicode", "active": true, "score": 0.1, "extra": [1, 2]}
        ],
        "empty_obj": {},
        "empty_arr": [],
        "note": "plain string",
        "big": 12345678901234567890
    }"#;

    fn mapped(text: &str) -> LazyDoc {
        let file = crate::doc::mapped::TempFile::new("fixture.json", text);
        LazyDoc::mapped(file.map()).expect("fixture parses from a map")
    }

    fn lazies(text: &str) -> [LazyDoc; 2] {
        [
            LazyDoc::new(sonic_rs::FastStr::new(text)).expect("fixture parses lazily"),
            mapped(text),
        ]
    }

    fn backends() -> (Value, [LazyDoc; 2]) {
        let eager: Value = serde_json::from_str(FIXTURE).expect("fixture parses");
        (eager, lazies(FIXTURE))
    }

    fn search(b: &dyn DocumentBackend, query: &str) -> Vec<SearchHit> {
        let opts = SearchOptions {
            query: query.into(),
            case_sensitive: false,
            max_results: None,
        };
        b.search(&opts, &CancelFlag::never(), &mut |_, _| {})
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
    fn row_fields_agree() {
        let (eager, lazies) = backends();
        let fields = |b: &dyn DocumentBackend| {
            let mut seen = Vec::new();
            let rows = b
                .for_each_row_field(&p(&[k("users")]), &CancelFlag::never(), &mut |key, kind| {
                    seen.push((key.to_string(), kind))
                })
                .unwrap();
            (rows, seen)
        };
        let (rows, seen) = fields(&eager);
        for lazy in &lazies {
            assert_eq!((rows, seen.clone()), fields(lazy));
        }
        assert_eq!(rows, 3);
        assert_eq!(seen.len(), 15);
        assert!(seen.contains(&("score".to_string(), NodeKind::Null)));
    }

    #[test]
    fn root_kind_and_count_agree() {
        let (eager, lazies) = backends();
        for lazy in &lazies {
            assert_eq!(
                DocumentBackend::root_kind_and_count(&eager),
                DocumentBackend::root_kind_and_count(lazy)
            );
        }
    }

    #[test]
    fn slices_are_byte_identical() {
        let (eager, lazies) = backends();
        for (lazy, path) in lazies
            .iter()
            .flat_map(|l| paths().into_iter().map(move |p| (l, p)))
        {
            for range in [0..0, 0..2, 0..100, 1..3, 5..10] {
                let e = DocumentBackend::slice(&eager, &path, range.clone());
                let l = DocumentBackend::slice(lazy, &path, range.clone());
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
        let (eager, lazies) = backends();
        for (lazy, path) in lazies
            .iter()
            .flat_map(|l| paths().into_iter().map(move |p| (l, p)))
        {
            assert_eq!(
                DocumentBackend::kind_at(&eager, &path).ok(),
                DocumentBackend::kind_at(lazy, &path).ok(),
                "kind_at {path}"
            );
            assert_eq!(
                DocumentBackend::child_count_at(&eager, &path).ok(),
                DocumentBackend::child_count_at(lazy, &path).ok(),
                "child_count_at {path}"
            );
            assert_eq!(
                DocumentBackend::get_value(&eager, &path).ok(),
                DocumentBackend::get_value(lazy, &path).ok(),
                "get_value {path}"
            );
        }
    }

    #[test]
    fn missing_paths_fail_on_both() {
        let (eager, lazies) = backends();
        let missing = p(&[k("users"), i(9)]);
        assert!(DocumentBackend::get_value(&eager, &missing).is_err());
        for lazy in &lazies {
            assert!(DocumentBackend::get_value(lazy, &missing).is_err());
        }
    }

    #[test]
    fn column_reads_agree() {
        let (eager, lazies) = backends();
        let users = p(&[k("users")]);
        let keys = ["id", "name", "active", "score", "extra", "nope"];
        for (lazy, key) in lazies.iter().flat_map(|l| keys.map(move |k| (l, k))) {
            assert_eq!(
                DocumentBackend::column_cells(&eager, &users, key).ok(),
                DocumentBackend::column_cells(lazy, &users, key).ok(),
                "column_cells {key}"
            );
            assert_eq!(
                DocumentBackend::column_text(&eager, &users, key).ok(),
                DocumentBackend::column_text(lazy, &users, key).ok(),
                "column_text {key}"
            );
            assert_eq!(
                DocumentBackend::column_keys(&eager, &users, key).ok(),
                DocumentBackend::column_keys(lazy, &users, key).ok(),
                "column_keys {key}"
            );
        }
    }

    #[test]
    fn search_hits_agree() {
        let (eager, lazies) = backends();
        for (lazy, query) in lazies
            .iter()
            .flat_map(|l| ["ada", "name", "unicode", "zzz-no-hit"].map(move |q| (l, q)))
        {
            assert_eq!(search(&eager, query), search(lazy, query), "search {query}");
        }
    }

    #[test]
    fn reads_across_index_checkpoints_agree() {
        let rows: Vec<String> = (0..300)
            .map(|n| format!(r#"{{"n": {n}, "s": "r{n}", "a": [{n}, {{"d": {n}}}]}}"#))
            .collect();
        let nested = format!(r#"{{"rows": [ {} ]}}"#, rows.join(" ,\n "));
        let root = format!("[{}]", rows.join(","));
        for (text, at) in [(nested, vec![k("rows")]), (root, vec![])] {
            let eager: Value = serde_json::from_str(&text).unwrap();
            let rows_path = p(&at);
            let row = |n: u32, rest: &[PathSegment]| {
                let mut segs = at.clone();
                segs.push(i(n));
                segs.extend_from_slice(rest);
                Path(segs)
            };
            for lazy in &lazies(&text) {
                for range in [
                    0..1,
                    63..65,
                    64..128,
                    127..200,
                    250..300,
                    299..400,
                    300..301,
                ] {
                    assert_eq!(
                        DocumentBackend::slice(&eager, &rows_path, range.clone()).ok(),
                        DocumentBackend::slice(lazy, &rows_path, range.clone()).ok(),
                        "slice {range:?}"
                    );
                }
                for n in [0, 63, 64, 65, 128, 191, 299, 300] {
                    for path in [row(n, &[]), row(n, &[k("a"), i(1), k("d")])] {
                        assert_eq!(
                            DocumentBackend::get_value(&eager, &path).ok(),
                            DocumentBackend::get_value(lazy, &path).ok(),
                            "get_value {path}"
                        );
                    }
                    let inner = row(n, &[k("a")]);
                    assert_eq!(
                        DocumentBackend::slice(&eager, &inner, 0..5).ok(),
                        DocumentBackend::slice(lazy, &inner, 0..5).ok(),
                        "slice {inner}"
                    );
                }
                assert_eq!(
                    DocumentBackend::column_keys(&eager, &rows_path, "s").ok(),
                    DocumentBackend::column_keys(lazy, &rows_path, "s").ok()
                );
                assert_eq!(
                    DocumentBackend::serialize_ndjson(&eager),
                    DocumentBackend::serialize_ndjson(lazy)
                );
                let count = |b: &dyn DocumentBackend| {
                    b.for_each_row_field(&rows_path, &CancelFlag::never(), &mut |_, _| {})
                        .unwrap()
                };
                assert_eq!(count(&eager), count(lazy));
            }
        }
    }

    #[test]
    fn previews_agree_for_large_containers_and_negative_zero() {
        let rows: Vec<String> = (0..10_000).map(|n| format!(r#"{{"n":{n}}}"#)).collect();
        let text = format!(r#"{{"big": [{}], "zero": -0}}"#, rows.join(","));
        let eager: Value = serde_json::from_str(&text).unwrap();
        for lazy in &lazies(&text) {
            for query in ["big", "zero"] {
                assert_eq!(search(&eager, query), search(lazy, query), "search {query}");
            }
            assert_eq!(
                DocumentBackend::slice(&eager, &Path::root(), 1..2).ok(),
                DocumentBackend::slice(lazy, &Path::root(), 1..2).ok(),
                "tree row for -0"
            );
        }
    }

    #[test]
    fn repeated_keys_keep_first_position_and_last_value_like_eager() {
        const REPEATED: &str = r#"{"a": 1, "rows": [{"x": "old", "y": 2, "x": "new"}], "b": 3, "a": {"z": "kept"}, "b": 4}"#;
        let eager: Value = serde_json::from_str(REPEATED).unwrap();
        let lazy = LazyDoc::new(REPEATED.into()).unwrap();
        assert_eq!(
            DocumentBackend::root_kind_and_count(&eager),
            DocumentBackend::root_kind_and_count(&lazy)
        );
        for path in [
            p(&[]),
            p(&[k("a")]),
            p(&[k("a"), k("z")]),
            p(&[k("b")]),
            p(&[k("rows")]),
            p(&[k("rows"), i(0)]),
            p(&[k("rows"), i(0), k("x")]),
        ] {
            assert_eq!(
                DocumentBackend::slice(&eager, &path, 0..10).ok(),
                DocumentBackend::slice(&lazy, &path, 0..10).ok(),
                "slice {path}"
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
        let rows = p(&[k("rows")]);
        assert_eq!(
            DocumentBackend::column_cells(&eager, &rows, "x").ok(),
            DocumentBackend::column_cells(&lazy, &rows, "x").ok()
        );
        assert_eq!(
            DocumentBackend::column_keys(&eager, &rows, "x").ok(),
            DocumentBackend::column_keys(&lazy, &rows, "x").ok()
        );
        for query in ["x", "old", "kept"] {
            assert_eq!(
                search(&eager, query),
                search(&lazy, query),
                "search {query}"
            );
        }
    }
}
