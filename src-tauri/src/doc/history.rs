use std::collections::VecDeque;

use super::ops::Op;

pub const DEFAULT_CAP: usize = 500;

pub const DEFAULT_BYTE_BUDGET: usize = 512 * 1024 * 1024;

#[derive(Debug)]
struct Entry {
    forward: Op,
    inverse: Op,
    bytes: usize,
}

impl Entry {
    fn new(forward: Op, inverse: Op) -> Self {
        let bytes = forward.heap_bytes() + inverse.heap_bytes();
        Self {
            forward,
            inverse,
            bytes,
        }
    }
}

#[derive(Debug)]
pub struct History {
    undo: VecDeque<Entry>,
    redo: VecDeque<Entry>,
    cap: usize,
    budget_bytes: usize,
    undo_bytes: usize,
    redo_bytes: usize,
}

impl History {
    pub fn new(cap: usize) -> Self {
        Self::with_caps(cap, DEFAULT_BYTE_BUDGET)
    }

    pub fn with_caps(cap: usize, budget_bytes: usize) -> Self {
        Self {
            undo: VecDeque::new(),
            redo: VecDeque::new(),
            cap,
            budget_bytes,
            undo_bytes: 0,
            redo_bytes: 0,
        }
    }

    pub fn record(&mut self, forward: Op, inverse: Op) {
        self.redo.clear();
        self.redo_bytes = 0;
        self.push_undo((forward, inverse));
    }

    pub fn pop_undo(&mut self) -> Option<(Op, Op)> {
        let e = self.undo.pop_back()?;
        self.undo_bytes -= e.bytes;
        Some((e.forward, e.inverse))
    }

    pub fn pop_redo(&mut self) -> Option<(Op, Op)> {
        let e = self.redo.pop_back()?;
        self.redo_bytes -= e.bytes;
        Some((e.forward, e.inverse))
    }

    pub fn push_undo(&mut self, entry: (Op, Op)) {
        let e = Entry::new(entry.0, entry.1);
        self.undo_bytes += e.bytes;
        self.undo.push_back(e);
        self.evict_undo();
    }

    pub fn push_redo(&mut self, entry: (Op, Op)) {
        let e = Entry::new(entry.0, entry.1);
        self.redo_bytes += e.bytes;
        self.redo.push_back(e);
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
        self.undo.iter().map(|e| &e.forward)
    }

    pub fn redo_ops(&self) -> impl Iterator<Item = &Op> {
        self.redo.iter().rev().map(|e| &e.forward)
    }

    pub fn cap(&self) -> usize {
        self.cap
    }

    fn evict_undo(&mut self) {
        while self.undo.len() > self.cap
            || (self.undo.len() > 1 && self.undo_bytes > self.budget_bytes)
        {
            match self.undo.pop_front() {
                Some(e) => self.undo_bytes -= e.bytes,
                None => break,
            }
        }
    }

    fn evict_redo(&mut self) {
        while self.redo.len() > self.cap
            || (self.redo.len() > 1 && self.redo_bytes > self.budget_bytes)
        {
            match self.redo.pop_front() {
                Some(e) => self.redo_bytes -= e.bytes,
                None => break,
            }
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

    #[test]
    fn byte_budget_evicts_oldest_keeping_newest() {
        // Budget far below a single entry's footprint: only the newest survives,
        // well under the op-count cap.
        let mut h = History::with_caps(100, 1);
        h.record(op(1), op(-1));
        h.record(op(2), op(-2));
        h.record(op(3), op(-3));
        assert_eq!(h.undo_len(), 1, "byte budget keeps only the newest entry");
        assert_eq!(h.pop_undo().unwrap().0, op(3), "and it is the most recent");
    }

    #[test]
    fn generous_budget_leaves_count_cap_in_charge() {
        let mut h = History::with_caps(2, usize::MAX);
        h.record(op(1), op(-1));
        h.record(op(2), op(-2));
        h.record(op(3), op(-3));
        assert_eq!(h.undo_len(), 2);
    }
}
