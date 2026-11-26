use std::fs::{File, Metadata};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use parking_lot::{Condvar, Mutex};

use super::progress::{Reporter, TICK_BYTES};
use super::scan::{scan, Rejected, Scanned};
use super::types::{BigFileProblem, DocError, DocResult, FileOp};

const BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Debug)]
pub struct MappedText {
    map: memmap2::Mmap,
    start: usize,
    path: PathBuf,
    name: String,
    opened: (u64, Option<SystemTime>),
}

impl MappedText {
    #[cfg(test)]
    pub fn open(path: &Path, name: String) -> DocResult<Self> {
        Self::open_scanned(path, name, Reporter::NONE).map(|(text, _)| text)
    }

    pub fn open_scanned(
        path: &Path,
        name: String,
        progress: Reporter,
    ) -> DocResult<(Self, Result<Scanned, Rejected>)> {
        let fail = |e| DocError::file(FileOp::Open, path, e);
        let file = File::open(path).map_err(fail)?;
        let opened = stamp(&file.metadata().map_err(fail)?);
        // SAFETY: read-only map; reads stop once `check_unchanged` sees the file change (ADR 0003).
        let map = unsafe { memmap2::Mmap::map(&file) }.map_err(fail)?;
        #[cfg(unix)]
        let _ = map.advise(memmap2::Advice::Sequential);
        let start = if map.starts_with(BOM) { BOM.len() } else { 0 };
        let bytes = &map[start..];
        let frontier = Frontier::default();
        let (scanned, utf8) = std::thread::scope(|scope| {
            let reader = scope.spawn(|| frontier.read_ahead(&map, start));
            let scanned = scan(bytes, &mut |to| frontier.wait_for(to), progress);
            frontier.release();
            let utf8 = reader
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic));
            (scanned, utf8)
        });
        if !utf8 {
            return Err(fail(std::io::ErrorKind::InvalidData.into()));
        }
        let text = Self {
            map,
            start,
            path: path.to_path_buf(),
            name,
            opened,
        };
        Ok((text, scanned))
    }

    pub fn as_str(&self) -> &str {
        // SAFETY: `open_scanned` builds Self only after checking every byte from `start` as UTF-8.
        unsafe { std::str::from_utf8_unchecked(&self.map[self.start..]) }
    }

    pub fn skipped_bom(&self) -> bool {
        self.start > 0
    }

    pub fn name(&self) -> String {
        self.name.clone()
    }

    pub fn check_unchanged(&self) -> DocResult<()> {
        match std::fs::metadata(&self.path) {
            Ok(meta) if stamp(&meta) == self.opened => Ok(()),
            _ => Err(DocError::BigFile(BigFileProblem::ChangedOnDisk {
                file: self.name(),
            })),
        }
    }
}

const READ_LEAD: usize = 4 * TICK_BYTES;

#[derive(Default)]
struct Frontier {
    state: Mutex<FrontierState>,
    moved: Condvar,
}

#[derive(Default)]
struct FrontierState {
    checked: usize,
    wanted: usize,
    done: bool,
    bad: bool,
}

impl Frontier {
    fn read_ahead(&self, map: &memmap2::Mmap, start: usize) -> bool {
        let bytes = &map[start..];
        let mut at = 0;
        while at < bytes.len() {
            {
                let mut state = self.state.lock();
                while at >= state.wanted.saturating_add(READ_LEAD) {
                    self.moved.wait(&mut state);
                }
            }
            let to = (at + TICK_BYTES).min(bytes.len());
            prefetch(map, start + to);
            match std::str::from_utf8(&bytes[at..to]) {
                Ok(_) => at = to,
                Err(e) if e.error_len().is_none() && to < bytes.len() => at += e.valid_up_to(),
                Err(_) => break,
            }
            self.state.lock().checked = at;
            self.moved.notify_all();
        }
        let mut state = self.state.lock();
        state.done = true;
        state.bad = at < bytes.len();
        self.moved.notify_all();
        !state.bad
    }

    fn wait_for(&self, to: usize) -> bool {
        let mut state = self.state.lock();
        state.wanted = to;
        self.moved.notify_all();
        while state.checked < to && !state.done {
            self.moved.wait(&mut state);
        }
        !state.bad
    }

    fn release(&self) {
        self.state.lock().wanted = usize::MAX;
        self.moved.notify_all();
    }
}

fn prefetch(map: &memmap2::Mmap, from: usize) {
    #[cfg(unix)]
    {
        let len = (2 * TICK_BYTES).min(map.len().saturating_sub(from));
        if len > 0 {
            let _ = map.advise_range(memmap2::Advice::WillNeed, from, len);
        }
    }
    #[cfg(not(unix))]
    let _ = (map, from);
}

fn stamp(meta: &Metadata) -> (u64, Option<SystemTime>) {
    (meta.len(), meta.modified().ok())
}

#[cfg(test)]
pub(crate) struct TempFile(pub PathBuf);

#[cfg(test)]
impl TempFile {
    pub fn new(name: &str, text: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "pandia-mapped-{}-{name}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&path, text).unwrap();
        Self(path)
    }

    pub fn map(&self) -> std::sync::Arc<MappedText> {
        let name = self.0.to_string_lossy().into_owned();
        std::sync::Arc::new(MappedText::open(&self.0, name).unwrap())
    }
}

#[cfg(test)]
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
