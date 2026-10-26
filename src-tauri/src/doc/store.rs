use std::sync::Arc;

use dashmap::DashMap;
use parking_lot::RwLock;

use super::document::Document;
use super::types::{DocError, DocHandle, DocResult};

#[derive(Default)]
pub struct DocStore {
    docs: DashMap<DocHandle, Arc<RwLock<Document>>>,
}

impl DocStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, doc: Document) -> DocHandle {
        let handle = DocHandle::new();
        self.docs.insert(handle, Arc::new(RwLock::new(doc)));
        handle
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.docs.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    pub fn read<T>(
        &self,
        handle: DocHandle,
        f: impl FnOnce(&Document) -> DocResult<T>,
    ) -> DocResult<T> {
        let doc = self.get(handle)?;
        let guard = doc.read();
        f(&guard)
    }

    pub fn write<T>(
        &self,
        handle: DocHandle,
        f: impl FnOnce(&mut Document) -> DocResult<T>,
    ) -> DocResult<T> {
        let doc = self.get(handle)?;
        let mut guard = doc.write();
        f(&mut guard)
    }

    pub fn read_both<T>(
        &self,
        left: DocHandle,
        right: DocHandle,
        f: impl FnOnce(&Document, &Document) -> DocResult<T>,
    ) -> DocResult<T> {
        let l = self.get(left)?;
        if left == right {
            let doc = l.read();
            return f(&doc, &doc);
        }
        let r = self.get(right)?;

        let (l_doc, r_doc) = if left.0 < right.0 {
            let l_doc = l.read();
            (l_doc, r.read())
        } else {
            let r_doc = r.read();
            (l.read(), r_doc)
        };
        f(&l_doc, &r_doc)
    }

    fn get(&self, handle: DocHandle) -> DocResult<Arc<RwLock<Document>>> {
        self.docs
            .get(&handle)
            .map(|entry| entry.clone())
            .ok_or(DocError::NotFound(handle))
    }

    pub fn remove(&self, handle: DocHandle) -> bool {
        self.docs.remove(&handle).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::ops::Op;
    use crate::doc::types::{DocError, Path};
    use std::thread;

    fn store_with_doc(text: &str) -> (DocStore, DocHandle) {
        let store = DocStore::new();
        let doc = Document::from_text(text, None).unwrap();
        let handle = store.insert(doc);
        (store, handle)
    }

    #[test]
    fn insert_get_remove_cycle() {
        let (store, handle) = store_with_doc(r#"{"a": 1}"#);
        assert_eq!(store.len(), 1);

        let arc = store.get(handle).expect("doc present");
        assert_eq!(arc.read().source_size, 8);

        assert!(store.remove(handle));
        assert!(store.is_empty());
        assert!(store.get(handle).is_err());
    }

    #[test]
    fn remove_unknown_handle_returns_false() {
        let store = DocStore::new();
        assert!(!store.remove(DocHandle::new()));
    }

    #[test]
    fn parallel_reads_dont_block_each_other() {
        let (store, handle) = store_with_doc(r#"{"a": 1, "b": 2, "c": 3}"#);
        let store = Arc::new(store);

        let handles: Vec<_> = (0..16)
            .map(|_| {
                let store = Arc::clone(&store);
                thread::spawn(move || {
                    store
                        .read(handle, |doc| doc.get_slice(&Path::root(), 0..10))
                        .unwrap()
                })
            })
            .collect();

        for h in handles {
            let slice = h.join().unwrap();
            assert_eq!(slice.len(), 3);
        }
    }

    #[test]
    fn an_unknown_handle_is_not_found_for_reads_and_writes() {
        let store = DocStore::new();
        let h = DocHandle::new();
        assert!(matches!(store.read(h, |_| Ok(())), Err(DocError::NotFound(x)) if x == h));
        assert!(matches!(store.write(h, |_| Ok(())), Err(DocError::NotFound(x)) if x == h));
        assert!(matches!(
            store.read_both(h, h, |_, _| Ok(())),
            Err(DocError::NotFound(x)) if x == h
        ));
    }

    #[test]
    fn a_write_is_seen_by_the_next_read() {
        let (store, handle) = store_with_doc(r#"{"a": 1}"#);
        store
            .write(handle, |doc| {
                doc.apply(&Op::SetValue {
                    path: Path::root(),
                    value: serde_json::json!({"a": 2}),
                })
            })
            .unwrap();
        let value = store.read(handle, |doc| doc.get_value(&Path::root()));
        assert_eq!(value.unwrap(), serde_json::json!({"a": 2}));
    }

    #[test]
    fn read_both_accepts_the_same_handle_on_both_sides() {
        let (store, handle) = store_with_doc(r#"{"a": 1}"#);
        let same = store.read_both(handle, handle, |l, r| Ok(std::ptr::eq(l, r)));
        assert!(same.unwrap());

        let other = store.insert(Document::from_text(r#"{"b": 2}"#, None).unwrap());
        let sizes = store.read_both(handle, other, |l, r| Ok((l.source_size, r.source_size)));
        assert_eq!(sizes.unwrap(), (8, 8));
        let missing = store.read_both(handle, DocHandle::new(), |_, _| Ok(()));
        assert!(matches!(missing, Err(DocError::NotFound(_))));
    }

    #[test]
    fn swapped_read_both_calls_never_deadlock_with_queued_writers() {
        let store = Arc::new(DocStore::new());
        let a = store.insert(Document::from_text("[1]", None).unwrap());
        let b = store.insert(Document::from_text("[22]", None).unwrap());
        let (done, finished) = std::sync::mpsc::channel();
        for (left, right) in [(a, b), (b, a)] {
            let (s, tx) = (Arc::clone(&store), done.clone());
            thread::spawn(move || {
                for _ in 0..200_000 {
                    let sizes = s.read_both(left, right, |l, r| Ok((l.source_size, r.source_size)));
                    let want = if left == a { (3, 4) } else { (4, 3) };
                    assert_eq!(sizes.unwrap(), want, "the closure gets the caller's order");
                }
                tx.send(()).unwrap();
            });
            let (s, tx) = (Arc::clone(&store), done.clone());
            thread::spawn(move || {
                for _ in 0..200_000 {
                    s.write(left, |_| Ok(())).unwrap();
                }
                tx.send(()).unwrap();
            });
        }
        for _ in 0..4 {
            finished
                .recv_timeout(std::time::Duration::from_secs(10))
                .expect("read_both deadlocked");
        }
    }

    #[test]
    fn closing_a_document_during_a_read_lets_the_read_finish() {
        let (store, handle) = store_with_doc(r#"{"a": 1}"#);
        let size = store.read(handle, |doc| {
            assert!(store.remove(handle));
            Ok(doc.source_size)
        });
        assert_eq!(size.unwrap(), 8);
        assert!(store.read(handle, |_| Ok(())).is_err());
    }
}
