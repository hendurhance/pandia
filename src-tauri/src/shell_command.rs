use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellCommand {
    pub installed: bool,
    pub location: String,
    // False when another installer owns the command, such as Homebrew's cask link.
    pub removable: bool,
}

fn app_executable() -> Result<std::path::PathBuf, String> {
    crate::cli::app_executable().ok_or_else(|| {
        "Pandia couldn't find its own program file. Reinstall Pandia, then try again.".into()
    })
}

#[cfg(target_os = "macos")]
mod platform {
    use super::ShellCommand;
    use std::path::Path;
    use std::process::{Command, Stdio};

    const LINK: &str = "/usr/local/bin/pandia";
    const HOMEBREW_LINK: &str = "/opt/homebrew/bin/pandia";

    pub fn status(_: &tauri::AppHandle) -> ShellCommand {
        let exe = super::app_executable().ok();
        let found = [LINK, HOMEBREW_LINK]
            .into_iter()
            .find(|link| super::is_installed(Path::new(link), exe.as_deref()));
        ShellCommand {
            installed: found.is_some(),
            location: found.unwrap_or(LINK).into(),
            removable: found != Some(HOMEBREW_LINK),
        }
    }

    pub fn install(_: &tauri::AppHandle) -> Result<(), String> {
        let target = super::app_executable()?;
        super::ensure_replaceable(Path::new(LINK), &target)?;
        let target = super::sh_quote(&target.to_string_lossy());
        run_as_admin(&format!(
            "mkdir -p /usr/local/bin && ln -sf {target} {LINK}"
        ))
    }

    pub fn remove(_: &tauri::AppHandle) -> Result<(), String> {
        super::ensure_replaceable(Path::new(LINK), &super::app_executable()?)?;
        run_as_admin(&format!("rm -f {LINK}"))
    }

    // /usr/local/bin is writable without a password on Intel Macs with Homebrew; elsewhere
    // macOS asks for one, as it does for VS Code's "Install 'code' command".
    fn run_as_admin(script: &str) -> Result<(), String> {
        let plain = Command::new("/bin/sh")
            .args(["-c", script])
            .stderr(Stdio::null())
            .status();
        if plain.is_ok_and(|s| s.success()) {
            return Ok(());
        }
        let apple_script = format!(
            "do shell script \"{}\" with prompt \"Pandia needs your password to change the pandia command in /usr/local/bin.\" with administrator privileges",
            script.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let out = Command::new("/usr/bin/osascript")
            .args(["-e", &apple_script])
            .output()
            .map_err(|_| "Pandia couldn't ask macOS for permission. Try again.".to_string())?;
        // -128 means the password prompt was cancelled, which is not an error.
        if out.status.success() || String::from_utf8_lossy(&out.stderr).contains("-128") {
            return Ok(());
        }
        Err("Pandia couldn't change /usr/local/bin. Check that your account is an administrator, then try again.".into())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::ShellCommand;
    use std::path::PathBuf;

    fn link() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/bin/pandia"))
    }

    pub fn status(_: &tauri::AppHandle) -> ShellCommand {
        let link = link();
        ShellCommand {
            installed: link
                .as_ref()
                .is_some_and(|l| super::is_installed(l, super::app_executable().ok().as_deref())),
            location: link.map_or("~/.local/bin/pandia".into(), |l| {
                l.to_string_lossy().into_owned()
            }),
            removable: true,
        }
    }

    pub fn install(_: &tauri::AppHandle) -> Result<(), String> {
        let target = super::app_executable()?;
        let link = link().ok_or("Pandia couldn't find your home folder.")?;
        super::ensure_replaceable(&link, &target)?;
        let failed = |_| {
            format!(
                "Pandia couldn't create {}. Check that you can write to that folder, then try again.",
                link.display()
            )
        };
        std::fs::create_dir_all(link.parent().unwrap_or(&link)).map_err(failed)?;
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&target, &link).map_err(failed)
    }

    pub fn remove(_: &tauri::AppHandle) -> Result<(), String> {
        match link() {
            Some(link) if link.symlink_metadata().is_ok() => {
                super::ensure_replaceable(&link, &super::app_executable()?)?;
                std::fs::remove_file(&link)
                    .map_err(|_| format!("Pandia couldn't remove {}.", link.display()))
            }
            _ => Ok(()),
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::ShellCommand;
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::Command;
    use tauri::Manager;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Edits the user PATH in the registry directly, keeping %VARIABLES% unexpanded, then sets
    // and clears a variable so open programs hear that the environment changed.
    const UPDATE_PATH: &str = "$dir = $env:PANDIA_BIN_DIR; \
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); \
        $old = [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); \
        $parts = @($old -split ';' | Where-Object { $_ -and $_ -ne $dir }); \
        if ($env:PANDIA_PATH_ACTION -eq 'add') { $parts += $dir }; \
        $key.SetValue('Path', ($parts -join ';'), 'ExpandString'); \
        $key.Close(); \
        [Environment]::SetEnvironmentVariable('PANDIA_PATH_REFRESH', '1', 'User'); \
        [Environment]::SetEnvironmentVariable('PANDIA_PATH_REFRESH', $null, 'User')";

    fn bin_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
        app.path()
            .app_local_data_dir()
            .ok()
            .map(|dir| dir.join("bin"))
    }

    pub fn status(app: &tauri::AppHandle) -> ShellCommand {
        let script = bin_dir(app).map(|dir| dir.join("pandia.cmd"));
        ShellCommand {
            installed: script.as_ref().is_some_and(|s| s.exists()),
            location: script.map_or("pandia.cmd".into(), |s| s.to_string_lossy().into_owned()),
            removable: true,
        }
    }

    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        let exe = super::app_executable()?;
        let dir = bin_dir(app).ok_or("Pandia couldn't find its data folder.")?;
        let script = dir.join("pandia.cmd");
        let failed = |_| {
            format!(
                "Pandia couldn't create {}. Check that you can write to that folder, then try again.",
                script.display()
            )
        };
        std::fs::create_dir_all(&dir).map_err(failed)?;
        std::fs::write(&script, super::cmd_script(&exe.to_string_lossy())).map_err(failed)?;
        if let Err(e) = update_path(&dir, "add") {
            let _ = std::fs::remove_file(&script);
            return Err(e);
        }
        Ok(())
    }

    pub fn remove(app: &tauri::AppHandle) -> Result<(), String> {
        let Some(dir) = bin_dir(app) else {
            return Ok(());
        };
        update_path(&dir, "remove")?;
        let _ = std::fs::remove_file(dir.join("pandia.cmd"));
        Ok(())
    }

    fn update_path(dir: &std::path::Path, action: &str) -> Result<(), String> {
        let ok = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", UPDATE_PATH])
            .env("PANDIA_BIN_DIR", dir)
            .env("PANDIA_PATH_ACTION", action)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success());
        if ok {
            Ok(())
        } else {
            Err("Pandia couldn't update your PATH. Try again, or add the folder to PATH in Windows Settings → Environment Variables.".into())
        }
    }
}

#[cfg(not(windows))]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

// Nothing there, a dangling link, or a link to this app's executable.
#[cfg(not(windows))]
fn is_replaceable(link: &std::path::Path, exe: &std::path::Path) -> bool {
    match std::fs::read_link(link) {
        Ok(target) => target == exe || !link.exists(),
        Err(_) => link.symlink_metadata().is_err(),
    }
}

#[cfg(not(windows))]
fn is_installed(link: &std::path::Path, exe: Option<&std::path::Path>) -> bool {
    link.exists() && exe.is_some_and(|exe| is_replaceable(link, exe))
}

#[cfg(not(windows))]
fn ensure_replaceable(link: &std::path::Path, exe: &std::path::Path) -> Result<(), String> {
    if is_replaceable(link, exe) {
        return Ok(());
    }
    Err(format!(
        "{} isn't Pandia's command, so Pandia left it alone. If you don't need it, rename or delete it yourself.",
        link.display()
    ))
}

// Run through cmd, so terminals wait for `--wait` and see Pandia's exit code.
#[cfg(any(windows, test))]
fn cmd_script(exe: &str) -> String {
    format!("@echo off\r\n\"{exe}\" %*\r\nexit /b %ERRORLEVEL%\r\n")
}

#[tauri::command]
#[specta::specta]
pub(crate) fn shell_command_status(app: AppHandle) -> ShellCommand {
    platform::status(&app)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn shell_command_install(app: AppHandle) -> Result<ShellCommand, String> {
    platform::install(&app)?;
    Ok(platform::status(&app))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn shell_command_remove(app: AppHandle) -> Result<ShellCommand, String> {
    platform::remove(&app)?;
    Ok(platform::status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(not(windows))]
    fn shell_quoting_survives_quotes_and_spaces() {
        assert_eq!(
            sh_quote("/Apps/Pan dia's.app/pandia"),
            r"'/Apps/Pan dia'\''s.app/pandia'"
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn only_pandias_own_link_is_replaced_or_removed() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("pandia-shell-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Pandia");
        let other = dir.join("other-tool");
        std::fs::write(&exe, "").unwrap();
        std::fs::write(&other, "").unwrap();
        let link = |name: &str, target: &std::path::Path| {
            let path = dir.join(name);
            symlink(target, &path).unwrap();
            path
        };

        assert!(ensure_replaceable(&dir.join("missing"), &exe).is_ok());
        assert!(ensure_replaceable(&link("ours", &exe), &exe).is_ok());
        let moved = link("moved", &dir.join("Old.app"));
        assert!(
            ensure_replaceable(&moved, &exe).is_ok(),
            "a copy that moved"
        );
        let theirs = link("theirs", &other);
        let err = ensure_replaceable(&theirs, &exe).unwrap_err();
        assert!(err.starts_with(&theirs.display().to_string()), "{err}");
        assert!(ensure_replaceable(&other, &exe).is_err(), "a program file");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[cfg(not(windows))]
    fn only_pandias_own_link_counts_as_installed() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("pandia-installed-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Pandia");
        let other = dir.join("other-tool");
        std::fs::write(&exe, "").unwrap();
        std::fs::write(&other, "").unwrap();
        let link = |name: &str, target: &std::path::Path| {
            let path = dir.join(name);
            symlink(target, &path).unwrap();
            path
        };

        let ours = link("ours", &exe);
        assert!(is_installed(&ours, Some(&exe)));
        assert!(!is_installed(&ours, None), "own executable unknown");
        assert!(!is_installed(&link("theirs", &other), Some(&exe)));
        assert!(!is_installed(&other, Some(&exe)), "a program file");
        assert!(!is_installed(
            &link("moved", &dir.join("Old.app")),
            Some(&exe)
        ));
        assert!(!is_installed(&dir.join("missing"), Some(&exe)));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn windows_command_forwards_arguments_and_exit_code() {
        assert_eq!(
            cmd_script(r"C:\Users\me\AppData\Local\Pandia\Pandia.exe"),
            "@echo off\r\n\"C:\\Users\\me\\AppData\\Local\\Pandia\\Pandia.exe\" %*\r\nexit /b %ERRORLEVEL%\r\n"
        );
    }
}
