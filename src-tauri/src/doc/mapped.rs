use std::fs::{File, Metadata};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

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
    pub fn open(path: &Path, name: String) -> DocResult<Self> {
        let fail = |e| DocError::file(FileOp::Open, path, e);
        let file = File::open(path).map_err(fail)?;
        let opened = stamp(&file.metadata().map_err(fail)?);
        // SAFETY: read-only map; reads stop once `check_unchanged` sees the file change (ADR 0003).
        let map = unsafe { memmap2::Mmap::map(&file) }.map_err(fail)?;
        #[cfg(unix)]
        let _ = map.advise(memmap2::Advice::Sequential);
        std::str::from_utf8(&map).map_err(|_| fail(std::io::ErrorKind::InvalidData.into()))?;
        let start = if map.starts_with(BOM) { BOM.len() } else { 0 };
        Ok(Self {
            map,
            start,
            path: path.to_path_buf(),
            name,
            opened,
        })
    }

    pub fn as_str(&self) -> &str {
        // SAFETY: `open` validated the whole map as UTF-8, and `start` is 0 or just past a BOM.
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
