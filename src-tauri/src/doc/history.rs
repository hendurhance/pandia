
use std::collections::VecDeque;

use super::ops::Op;

pub const DEFAULT_CAP: usize = 500;

#[derive(Debug)]
pub struct History {
    undo: VecDeque<(Op, Op)>,
    redo: VecDeque<(Op, Op)>,
    cap: usize,
}

impl History {
    pub fn new(cap: usize) -> Self {
        Self {
            undo: VecDeque::new(),
            redo: VecDeque::new(),
            cap,
        }
    }

    pub fn record(&mut self, forward: Op, inverse: Op) {
        self.redo.clear();
        self.undo.push_back((forward, inverse));
        self.evict_undo();
    }

    pub fn pop_undo(&mut self) -> Option<(Op, Op)> {
        self.undo.pop_back()
    }

    pub fn pop_redo(&mut self) -> Option<(Op, Op)> {
        self.redo.pop_back()
    }

    pub fn push_undo(&mut self, entry: (Op, Op)) {
        self.undo.push_back(entry);
        self.evict_undo();
    }

    pub fn push_redo(&mut self, entry: (Op, Op)) {
        self.redo.push_back(entry);
        self.evict_redo();
    }

    #[allow(dead_code)] // exposed for Document::history_lens + history tests
    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }

    #[allow(dead_code)] // exposed for Document::history_lens + history tests
    pub fn redo_len(&self) -> usize {
        self.redo.len()
    }

    pub fn undo_ops(&self) -> impl Iterator<Item = &Op> {
        self.undo.iter().map(|(forward, _)| forward)
    }

    pub fn redo_ops(&self) -> impl Iterator<Item = &Op> {
        self.redo.iter().rev().map(|(forward, _)| forward)
    }

    pub fn cap(&self) -> usize {
        self.cap
    }

    fn evict_undo(&mut self) {
        while self.undo.len() > self.cap {
            self.undo.pop_front();
        }
    }

    fn evict_redo(&mut self) {
        while self.redo.len() > self.cap {
            self.redo.pop_front();
        }
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new(DEFAULT_CAP)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::types::Path;

    fn op(value: i64) -> Op {
        Op::SetValue {
            path: Path::root(),
            value: serde_json::json!(value),
        }
    }

    fn pair(value: i64) -> (Op, Op) {
        (op(value), op(-value))
    }

    #[test]
    fn record_pushes_to_undo_and_clears_redo() {
        let mut h = History::new(10);
        h.push_redo(pair(1));
        assert_eq!(h.redo_len(), 1);
        h.record(op(2), op(-2));
        assert_eq!(h.undo_len(), 1);
        assert_eq!(h.redo_len(), 0, "new edit should clear the redo stack");
    }

    #[test]
    fn pop_undo_returns_most_recent() {
        let mut h = History::new(10);
        h.record(op(1), op(-1));
        h.record(op(2), op(-2));
        let popped = h.pop_undo().unwrap();
        assert_eq!(popped.0, op(2));
        assert_eq!(h.undo_len(), 1);
    }

    #[test]
    fn pop_undo_on_empty_returns_none() {
        let mut h = History::new(10);
        assert!(h.pop_undo().is_none());
    }

    #[test]
    fn cap_eviction_drops_oldest_undo() {
        let mut h = History::new(3);
        h.record(op(1), op(-1));
        h.record(op(2), op(-2));
        h.record(op(3), op(-3));
        h.record(op(4), op(-4));
        assert_eq!(h.undo_len(), 3);
        let popped: Vec<_> = std::iter::from_fn(|| h.pop_undo())
            .map(|(f, _)| f)
            .collect();
        assert_eq!(popped, vec![op(4), op(3), op(2)]);
    }

    #[test]
    fn cap_eviction_applies_to_redo_as_well() {
        let mut h = History::new(2);
        h.push_redo(pair(1));
        h.push_redo(pair(2));
        h.push_redo(pair(3));
        assert_eq!(h.redo_len(), 2);
        let popped: Vec<_> = std::iter::from_fn(|| h.pop_redo())
            .map(|(f, _)| f)
            .collect();
        assert_eq!(popped, vec![op(3), op(2)]);
    }

    #[test]
    fn push_undo_does_not_clear_redo() {
        let mut h = History::new(10);
        h.push_redo(pair(1));
        h.push_undo(pair(2));
        assert_eq!(h.undo_len(), 1);
        assert_eq!(h.redo_len(), 1);
    }

    #[test]
    fn default_cap_is_500() {
        let h = History::default();
        assert_eq!(h.cap(), DEFAULT_CAP);
        assert_eq!(h.cap(), 500);
    }
}
