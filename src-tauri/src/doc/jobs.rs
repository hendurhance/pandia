
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

#[derive(Clone, Debug, Default)]
pub struct CancelFlag {
    cancelled: Arc<AtomicBool>,
}

impl CancelFlag {
    pub fn never() -> Self {
        Self::default()
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

#[derive(Default)]
pub struct JobRegistry {
    inner: Mutex<HashMap<String, CancelFlag>>,
}

impl JobRegistry {
    pub fn register(&self, id: String) -> CancelFlag {
        let flag = CancelFlag::default();
        self.inner.lock().insert(id, flag.clone());
        flag
    }

    pub fn unregister(&self, id: &str) {
        self.inner.lock().remove(id);
    }

    pub fn cancel(&self, id: &str) -> bool {
        match self.inner.lock().get(id) {
            Some(flag) => {
                flag.cancel();
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_flag_starts_uncancelled() {
        let flag = CancelFlag::default();
        assert!(!flag.is_cancelled());
        flag.cancel();
        assert!(flag.is_cancelled());
    }

    #[test]
    fn register_then_cancel_flips_flag() {
        let reg = JobRegistry::default();
        let flag = reg.register("a".into());
        assert!(!flag.is_cancelled());
        assert!(reg.cancel("a"));
        assert!(flag.is_cancelled());
    }

    #[test]
    fn cancel_unknown_id_returns_false() {
        let reg = JobRegistry::default();
        assert!(!reg.cancel("nope"));
    }

    #[test]
    fn unregister_removes_flag_from_future_cancels() {
        let reg = JobRegistry::default();
        let flag = reg.register("a".into());
        reg.unregister("a");
        assert!(!reg.cancel("a"));
        flag.cancel();
        assert!(flag.is_cancelled());
    }

    #[test]
    fn never_flag_is_always_uncancelled() {
        let f = CancelFlag::never();
        assert!(!f.is_cancelled());
    }
}
