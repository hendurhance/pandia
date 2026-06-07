use std::sync::Arc;

use dashmap::DashMap;
use parking_lot::RwLock;

use super::document::Document;
use super::types::DocHandle;

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

    pub fn get(&self, handle: DocHandle) -> Option<Arc<RwLock<Document>>> {
        self.docs.get(&handle).map(|entry| entry.clone())
    }

    pub fn remove(&self, handle: DocHandle) -> bool {
        self.docs.remove(&handle).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::types::Path;
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
        assert!(store.get(handle).is_none());
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
                    let arc = store.get(handle).unwrap();
                    let doc = arc.read();
                    doc.get_slice(&Path::root(), 0..10).unwrap()
                })
            })
            .collect();

        for h in handles {
            let slice = h.join().unwrap();
            assert_eq!(slice.len(), 3);
        }
    }

    #[test]
    fn arc_keeps_doc_alive_after_remove() {
        let (store, handle) = store_with_doc(r#"{"a": 1}"#);
        let arc = store.get(handle).unwrap();
        assert!(store.remove(handle));
        assert_eq!(arc.read().source_size, 8);
    }
}
