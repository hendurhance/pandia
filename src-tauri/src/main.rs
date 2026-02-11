use tauri::{
    menu::{Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder, Submenu},
    Manager, Emitter, AppHandle, Wry, RunEvent,
};
use std::sync::Mutex;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

// Recent file structure matching frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentFile {
    path: String,
    name: String,
}

// App state for managing recent files menu and pending file opens
struct AppState {
    recent_files_menu: Mutex<Option<Submenu<Wry>>>,
    pending_files: Mutex<Vec<String>>,
}

// Supported file extensions for file association
const SUPPORTED_EXTENSIONS: &[&str] = &["json", "jsonc", "json5", "geojson", "jsonl", "ndjson"];

/// Check if a file path has a supported extension
fn is_supported_file(path: &str) -> bool {
    let path = PathBuf::from(path);
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        return SUPPORTED_EXTENSIONS.contains(&ext_str.as_str());
    }
    false
}

/// Emit file open event to the frontend
fn emit_file_open(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    // Filter to only supported files
    let supported_paths: Vec<String> = paths
        .into_iter()
        .filter(|p| is_supported_file(p))
        .collect();

    if supported_paths.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("file-open", &supported_paths);
    } else {
        // Window not ready, store for later
        if let Some(state) = app.try_state::<AppState>() {
            let mut pending = state.pending_files.lock().unwrap();
            pending.extend(supported_paths);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Collect CLI arguments (skip the first one which is the executable path)
    let cli_files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && is_supported_file(arg))
        .collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            recent_files_menu: Mutex::new(None),
            pending_files: Mutex::new(cli_files),
        })
        .invoke_handler(tauri::generate_handler![
            read_file_content,
            write_file_content,
            validate_json,
            format_json,
            compress_json,
            calculate_json_size,
            update_recent_files_menu,
            get_pending_files
        ])
        .setup(|app| {
            // Build the menu
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .on_menu_event(handle_menu_event)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // Handle file open events (macOS: double-click file in Finder, drag to dock icon)
                RunEvent::Opened { urls } => {
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|url| {
                            // Handle file:// URLs
                            if url.scheme() == "file" {
                                url.to_file_path().ok().map(|p| p.to_string_lossy().to_string())
                            } else {
                                None
                            }
                        })
                        .collect();

                    emit_file_open(app, paths);
                }
                _ => {}
            }
        });
}

fn build_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // App menu (Pandia)
    let about = MenuItemBuilder::with_id("about", "About Pandia")
        .build(app)?;
    let check_for_updates = MenuItemBuilder::with_id("check_for_updates", "Check for Updates...")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Pandia")
        .item(&about)
        .item(&check_for_updates)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Pandia"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Pandia"))?)
        .build()?;

    // File menu
    let new_file = MenuItemBuilder::with_id("new_file", "New File")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id("open_file", "Open File...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    // Recent Files submenu (initially empty, will be populated by frontend)
    let no_recent = MenuItemBuilder::with_id("no_recent", "No Recent Files")
        .enabled(false)
        .build(app)?;
    let clear_recent = MenuItemBuilder::with_id("clear_recent_files", "Clear Recent Files")
        .build(app)?;

    let recent_files_menu = SubmenuBuilder::new(app, "Open Recent")
        .item(&no_recent)
        .separator()
        .item(&clear_recent)
        .build()?;

    // Store the recent files menu reference for later updates
    if let Some(state) = app.try_state::<AppState>() {
        let mut menu_lock = state.recent_files_menu.lock().unwrap();
        *menu_lock = Some(recent_files_menu.clone());
    }

    let save_file = MenuItemBuilder::with_id("save_file", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save_as", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_file)
        .item(&open_file)
        .item(&recent_files_menu)
        .separator()
        .item(&save_file)
        .item(&save_as)
        .separator()
        .item(&close_tab)
        .build()?;

    // Edit menu
    let undo = MenuItemBuilder::with_id("undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo = MenuItemBuilder::with_id("redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let find = MenuItemBuilder::with_id("find", "Find...")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let find_replace = MenuItemBuilder::with_id("find_replace", "Find and Replace...")
        .accelerator("CmdOrCtrl+H")
        .build(app)?;
    let format_document = MenuItemBuilder::with_id("format_document", "Format Document")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cut"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copy"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Paste"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Select All"))?)
        .separator()
        .item(&find)
        .item(&find_replace)
        .separator()
        .item(&format_document)
        .build()?;

    // View menu
    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_tree_view = MenuItemBuilder::with_id("toggle_tree_view", "Tree View")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let toggle_code_view = MenuItemBuilder::with_id("toggle_code_view", "Code View")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let toggle_form_view = MenuItemBuilder::with_id("toggle_form_view", "Grid View")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .separator()
        .item(&toggle_tree_view)
        .item(&toggle_code_view)
        .item(&toggle_form_view)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some("Toggle Fullscreen"))?)
        .build()?;

    // Tools menu
    let validate_json_item = MenuItemBuilder::with_id("validate_json", "Validate JSON")
        .accelerator("CmdOrCtrl+Shift+V")
        .build(app)?;
    let repair_json = MenuItemBuilder::with_id("repair_json", "Repair JSON")
        .build(app)?;
    let compare_files = MenuItemBuilder::with_id("compare_files", "Compare Files")
        .build(app)?;
    let graph_visualizer = MenuItemBuilder::with_id("graph_visualizer", "Graph Visualizer")
        .build(app)?;

    let tools_menu = SubmenuBuilder::new(app, "Tools")
        .item(&validate_json_item)
        .item(&repair_json)
        .separator()
        .item(&compare_files)
        .item(&graph_visualizer)
        .build()?;

    // Help menu
    let keyboard_shortcuts = MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let view_modes_help = MenuItemBuilder::with_id("view_modes_help", "View Modes")
        .build(app)?;
    let documentation = MenuItemBuilder::with_id("documentation", "Documentation")
        .build(app)?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&keyboard_shortcuts)
        .item(&view_modes_help)
        .separator()
        .item(&documentation)
        .build()?;

    // Build the complete menu
    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &tools_menu,
            &help_menu,
        ],
    )?;

    Ok(menu)
}

fn handle_menu_event(app: &tauri::AppHandle, event: MenuEvent) {
    let menu_id = event.id().as_ref();

    // Emit the menu event to the frontend
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("menu-event", menu_id);
    }
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(err) => Err(format!("Failed to read file: {}", err)),
    }
}

#[tauri::command]
async fn write_file_content(path: String, content: String) -> Result<(), String> {
    match std::fs::write(&path, content) {
        Ok(_) => Ok(()),
        Err(err) => Err(format!("Failed to write file: {}", err)),
    }
}

#[tauri::command]
async fn validate_json(content: String) -> Result<bool, String> {
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(_) => Ok(true),
        Err(err) => Err(format!("Invalid JSON: {}", err)),
    }
}

#[tauri::command]
async fn format_json(content: String, indent: Option<usize>) -> Result<String, String> {
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(value) => {
            let indent_size = indent.unwrap_or(2);
            let spaces = " ".repeat(indent_size);
            match serde_json::to_string_pretty(&value) {
                Ok(formatted) => {
                    if indent_size != 2 {
                        let custom_formatted = formatted
                            .lines()
                            .map(|line| {
                                let leading_spaces = line.len() - line.trim_start().len();
                                let custom_indent = spaces.repeat(leading_spaces / 2);
                                format!("{}{}", custom_indent, line.trim_start())
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        Ok(custom_formatted)
                    } else {
                        Ok(formatted)
                    }
                }
                Err(err) => Err(format!("Failed to format JSON: {}", err)),
            }
        }
        Err(err) => Err(format!("Invalid JSON: {}", err)),
    }
}

#[tauri::command]
async fn compress_json(content: String) -> Result<String, String> {
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(value) => match serde_json::to_string(&value) {
            Ok(compressed) => Ok(compressed),
            Err(err) => Err(format!("Failed to compress JSON: {}", err)),
        },
        Err(err) => Err(format!("Invalid JSON: {}", err)),
    }
}

#[tauri::command]
async fn calculate_json_size(content: String) -> Result<serde_json::Value, String> {
    let raw_size = content.len();

    let gzip_size = (raw_size as f64 * 0.7) as usize;
    let brotli_size = (raw_size as f64 * 0.6) as usize;

    let result = serde_json::json!({
        "raw": raw_size,
        "gzip": gzip_size,
        "brotli": brotli_size
    });

    Ok(result)
}

/// Get any pending files that were opened before the frontend was ready
/// This is called once when the frontend initializes to handle files passed via CLI or macOS open events
#[tauri::command]
async fn get_pending_files(app: AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let mut pending = state.pending_files.lock().unwrap();
    let files = pending.drain(..).collect();
    Ok(files)
}

#[tauri::command]
async fn update_recent_files_menu(
    app: AppHandle,
    recent_files: Vec<RecentFile>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let menu_lock = state.recent_files_menu.lock().unwrap();

    if let Some(recent_menu) = menu_lock.as_ref() {
        // Remove all existing items
        while let Ok(Some(item)) = recent_menu.remove_at(0) {
            drop(item);
        }

        // Add recent file items
        if recent_files.is_empty() {
            let no_recent = MenuItemBuilder::with_id("no_recent", "No Recent Files")
                .enabled(false)
                .build(&app)
                .map_err(|e| e.to_string())?;
            recent_menu.append(&no_recent).map_err(|e| e.to_string())?;
        } else {
            for (index, file) in recent_files.iter().take(10).enumerate() {
                let menu_id = format!("recent_file_{}", index);
                let item = MenuItemBuilder::with_id(&menu_id, &file.name)
                    .build(&app)
                    .map_err(|e| e.to_string())?;
                recent_menu.append(&item).map_err(|e| e.to_string())?;
            }
        }

        // Add separator and clear option
        recent_menu
            .append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

        let clear_recent = MenuItemBuilder::with_id("clear_recent_files", "Clear Recent Files")
            .build(&app)
            .map_err(|e| e.to_string())?;
        recent_menu.append(&clear_recent).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn main() {
    run();
}
