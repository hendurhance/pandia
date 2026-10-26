use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT_TEMP: AtomicU32 = AtomicU32::new(0);

pub fn write_atomic(
    path: &Path,
    write: impl FnOnce(&mut BufWriter<File>) -> io::Result<()>,
) -> io::Result<()> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let temp = temp_sibling(&target);
    let file = match File::create(&temp) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            return write_in_place(&target, write)
        }
        Err(e) => return Err(e),
    };
    let result = finish(file, &temp, &target, write);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn finish(
    file: File,
    temp: &Path,
    target: &Path,
    write: impl FnOnce(&mut BufWriter<File>) -> io::Result<()>,
) -> io::Result<()> {
    if let Ok(meta) = fs::metadata(target) {
        file.set_permissions(meta.permissions())?;
    }
    let mut w = BufWriter::new(file);
    write(&mut w)?;
    w.into_inner().map_err(|e| e.into_error())?.sync_all()?;
    if let Err(rename) = fs::rename(temp, target) {
        fs::copy(temp, target).map_err(|_| rename)?;
        fs::remove_file(temp)?;
    }
    Ok(())
}

fn write_in_place(
    target: &Path,
    write: impl FnOnce(&mut BufWriter<File>) -> io::Result<()>,
) -> io::Result<()> {
    let mut w = BufWriter::new(File::create(target)?);
    write(&mut w)?;
    w.flush()
}

fn temp_sibling(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    target.with_file_name(format!(".{name}.{}-{n}.pandia-tmp", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl std::ops::Deref for TempDir {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn dir(name: &str) -> TempDir {
        let d = std::env::temp_dir().join(format!("pandia-atomic-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        TempDir(d)
    }

    fn entries(d: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(d)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn replaces_the_file_and_leaves_no_temp_behind() {
        let d = dir("replace");
        let p = d.join("a.json");
        fs::write(&p, "old").unwrap();
        write_atomic(&p, |w| w.write_all(b"new")).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
        assert_eq!(entries(&d), ["a.json"]);
    }

    #[test]
    fn a_failed_write_keeps_the_old_file_and_removes_the_temp() {
        let d = dir("fail");
        let p = d.join("a.json");
        fs::write(&p, "old").unwrap();
        let err = write_atomic(&p, |w| {
            w.write_all(b"half")?;
            Err(io::Error::other("disk full"))
        });
        assert!(err.is_err());
        assert_eq!(fs::read_to_string(&p).unwrap(), "old");
        assert_eq!(entries(&d), ["a.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_permissions_and_writes_through_a_symlink() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let d = dir("link");
        let real = d.join("real.json");
        fs::write(&real, "old").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o600)).unwrap();
        let link = d.join("link.json");
        symlink(&real, &link).unwrap();

        write_atomic(&link, |w| w.write_all(b"new")).unwrap();

        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
        let mode = fs::metadata(&real).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
