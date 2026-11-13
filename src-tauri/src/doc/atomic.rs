use std::fs::{self, File};
use std::io::{self, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT_TEMP: AtomicU32 = AtomicU32::new(0);

pub fn create_private(path: &Path) -> io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

pub fn write_atomic(
    path: &Path,
    write: impl FnOnce(&mut BufWriter<File>) -> io::Result<()>,
) -> io::Result<()> {
    let target = resolve_target(path);
    let existing = fs::metadata(&target).ok();
    if existing.as_ref().is_some_and(fs::Metadata::is_file) {
        fs::OpenOptions::new().write(true).open(&target)?;
    }
    #[cfg(unix)]
    if existing
        .as_ref()
        .is_some_and(|m| std::os::unix::fs::MetadataExt::nlink(m) > 1)
    {
        return write_in_place(&target, write);
    }
    let temp = temp_sibling(&target);
    let file = match File::create(&temp) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            return write_in_place(&target, write)
        }
        Err(e) => return Err(e),
    };
    let result = finish(file, &temp, &target, existing.as_ref(), write);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn resolve_target(path: &Path) -> PathBuf {
    if let Ok(real) = fs::canonicalize(path) {
        return real;
    }
    match fs::read_link(path) {
        Ok(dest) => path
            .parent()
            .map_or_else(|| dest.clone(), |dir| dir.join(&dest)),
        Err(_) => path.to_path_buf(),
    }
}

fn finish(
    file: File,
    temp: &Path,
    target: &Path,
    existing: Option<&fs::Metadata>,
    write: impl FnOnce(&mut BufWriter<File>) -> io::Result<()>,
) -> io::Result<()> {
    if let Some(meta) = existing {
        #[cfg(unix)]
        copy_owner_and_xattrs(&file, target, meta)?;
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
    w.into_inner().map_err(|e| e.into_error())?.sync_all()
}

#[cfg(unix)]
fn copy_owner_and_xattrs(file: &File, target: &Path, meta: &fs::Metadata) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    use xattr::FileExt;
    for name in xattr::list(target).into_iter().flatten() {
        if let Ok(Some(value)) = xattr::get(target, &name) {
            let _ = file.set_xattr(&name, &value);
        }
    }
    match std::os::unix::fs::fchown(file, Some(meta.uid()), Some(meta.gid())) {
        Err(e) if e.kind() != io::ErrorKind::PermissionDenied => Err(e),
        _ => Ok(()),
    }
}

fn temp_sibling(target: &Path) -> PathBuf {
    let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    target.with_file_name(format!(".pandia-{}-{n}.tmp", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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

    #[cfg(unix)]
    fn running_as_root(d: &Path) -> bool {
        use std::os::unix::fs::MetadataExt;
        let probe = d.join("probe");
        fs::write(&probe, "").unwrap();
        let root = fs::metadata(&probe).unwrap().uid() == 0;
        fs::remove_file(&probe).unwrap();
        root
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_replace_a_read_only_file() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("readonly");
        if running_as_root(&d) {
            return;
        }
        let p = d.join("ro.json");
        fs::write(&p, "old").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o444)).unwrap();

        let err = write_atomic(&p, |w| w.write_all(b"new")).unwrap_err();

        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(fs::read_to_string(&p).unwrap(), "old");
        assert_eq!(entries(&d), ["ro.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_extended_attributes() {
        let d = dir("xattr");
        let p = d.join("a.json");
        fs::write(&p, "old").unwrap();
        let mut names = vec!["user.pandia-note"];
        if cfg!(target_os = "macos") {
            names.push("com.apple.metadata:_kMDItemUserTags");
        }
        if names.iter().any(|n| xattr::set(&p, n, b"keep me").is_err()) {
            return;
        }

        write_atomic(&p, |w| w.write_all(b"new")).unwrap();

        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
        for n in names {
            assert_eq!(
                xattr::get(&p, n).unwrap().as_deref(),
                Some(&b"keep me"[..]),
                "{n}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_group_of_the_file() {
        use std::os::unix::fs::MetadataExt;
        let d = dir("group");
        let p = d.join("a.json");
        fs::write(&p, "old").unwrap();
        let default_gid = fs::metadata(&p).unwrap().gid();
        let groups = std::process::Command::new("id").arg("-G").output().unwrap();
        let other = String::from_utf8_lossy(&groups.stdout)
            .split_whitespace()
            .filter_map(|g| g.parse::<u32>().ok())
            .find(|&g| g != default_gid && std::os::unix::fs::chown(&p, None, Some(g)).is_ok());
        let Some(other) = other else {
            return;
        };

        write_atomic(&p, |w| w.write_all(b"new")).unwrap();

        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
        assert_eq!(fs::metadata(&p).unwrap().gid(), other);
    }

    #[cfg(unix)]
    #[test]
    fn a_second_hard_link_sees_the_new_content() {
        let d = dir("hardlink");
        let p = d.join("a.json");
        let other = d.join("b.json");
        fs::write(&p, "old").unwrap();
        fs::hard_link(&p, &other).unwrap();

        write_atomic(&p, |w| w.write_all(b"new")).unwrap();

        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
        assert_eq!(fs::read_to_string(&other).unwrap(), "new");
        assert_eq!(entries(&d), ["a.json", "b.json"]);
    }

    #[test]
    fn saves_a_file_whose_name_is_near_the_length_limit() {
        let d = dir("longname");
        let p = d.join(format!("{}.json", "a".repeat(245)));
        fs::write(&p, "old").unwrap();

        write_atomic(&p, |w| w.write_all(b"new")).unwrap();

        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
        assert_eq!(entries(&d).len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn writes_through_a_dangling_symlink_to_its_target() {
        use std::os::unix::fs::symlink;
        let d = dir("dangling");
        let link = d.join("link.json");
        symlink("missing.json", &link).unwrap();

        write_atomic(&link, |w| w.write_all(b"new")).unwrap();

        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(d.join("missing.json")).unwrap(), "new");
    }
}
