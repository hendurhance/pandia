use std::io::Write;

pub(crate) const REPORT_ENV: &str = "PANDIA_E2E_REPORT";

pub(crate) fn record(event: &serde_json::Value) {
    let Some(path) = std::env::var_os(REPORT_ENV) else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{event}");
    }
}

#[tauri::command]
#[specta::specta]
pub fn e2e_record(event: String) {
    if let Ok(event) = serde_json::from_str(&event) {
        record(&event);
    }
}

pub(crate) const CONTROL_ENV: &str = "PANDIA_E2E_CONTROL";

#[tauri::command]
#[specta::specta]
pub fn e2e_enabled() -> bool {
    std::env::var_os(REPORT_ENV).is_some()
}

#[tauri::command]
#[specta::specta]
pub fn e2e_take_actions() -> Vec<String> {
    let Some(path) = std::env::var_os(CONTROL_ENV).map(std::path::PathBuf::from) else {
        return Vec::new();
    };
    let taking = path.with_extension("taking");
    if std::fs::rename(&path, &taking).is_err() {
        return Vec::new();
    }
    let text = std::fs::read_to_string(&taking).unwrap_or_default();
    let _ = std::fs::remove_file(&taking);
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(str::to_string)
        .collect()
}
