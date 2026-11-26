use serde::Serialize;

pub const TICK_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OpenPhase {
    Reading,
    Checking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenProgress {
    pub phase: OpenPhase,
    pub done: u64,
    pub total: u64,
}

#[derive(Clone, Copy)]
pub struct Reporter<'a>(Option<&'a (dyn Fn(OpenProgress) + Sync)>);

impl<'a> Reporter<'a> {
    pub const NONE: Reporter<'static> = Reporter(None);

    pub fn new(report: &'a (dyn Fn(OpenProgress) + Sync)) -> Self {
        Self(Some(report))
    }

    pub fn step(self, phase: OpenPhase, done: usize, total: usize) {
        if let Some(report) = self.0 {
            report(OpenProgress {
                phase,
                done: done as u64,
                total: total as u64,
            });
        }
    }
}
