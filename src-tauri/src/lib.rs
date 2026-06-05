
mod commands;
pub(crate) mod doc;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, RunEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RecentFile {
    pub path: String,
    pub name: String,
}

pub(crate) struct AppState {
    pub pending_files: Mutex<Vec<String>>,
}

const SUPPORTED_EXTENSIONS: &[&str] = &["json", "jsonc", "json5", "geojson", "jsonl", "ndjson"];

fn is_supported_file(path: &str) -> bool {
    let path = PathBuf::from(path);
    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        return SUPPORTED_EXTENSIONS.contains(&ext_str.as_str());
    }
    false
}

fn emit_file_open(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let supported_paths: Vec<String> = paths.into_iter().filter(|p| is_supported_file(p)).collect();

    if supported_paths.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("file-open", &supported_paths);
    } else if let Some(state) = app.try_state::<AppState>() {
        let mut pending = state.pending_files.lock().unwrap();
        pending.extend(supported_paths);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            pending_files: Mutex::new(cli_files),
        })
        .manage(doc::store::DocStore::new())
        .manage(std::sync::Arc::new(doc::jobs::JobRegistry::default()))
        .invoke_handler(tauri::generate_handler![
            commands::doc_open,
            commands::doc_close,
            commands::doc_get_slice,
            commands::doc_get_value,
            commands::doc_get_rows,
            commands::doc_get_rows_sorted,
            commands::doc_get_rows_filtered,
            commands::doc_column_values,
            commands::doc_get_rows_at,
            commands::doc_summary,
            commands::doc_column_schema,
            commands::doc_apply_op,
            commands::doc_set_root_text,
            commands::doc_undo,
            commands::doc_redo,
            commands::doc_diff,
            commands::doc_search,
            commands::cancel_job,
            commands::doc_replace,
            commands::doc_repair_text,
            commands::doc_validate_schema,
            commands::doc_generate_types,
            commands::doc_detect_and_convert,
            commands::doc_history,
            commands::doc_save,
            commands::doc_set_file_path,
            commands::doc_backup,
            commands::doc_backup_clear,
            commands::doc_backup_scan,
            commands::doc_export,
            commands::doc_export_preview,
            commands::doc_export_to_file,
            refresh_recent_files,
        ])
        .setup(|app| {
            let menu = build_menu(app.handle(), &[])?;
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
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        if url.scheme() == "file" {
                            url.to_file_path()
                                .ok()
                                .map(|p: std::path::PathBuf| p.to_string_lossy().to_string())
                        } else {
                            None
                        }
                    })
                    .collect();

                emit_file_open(app, paths);
            }
            let _ = (app, event);
        });
}

fn build_menu(
    app: &tauri::AppHandle,
    recents: &[RecentFile],
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let about = MenuItemBuilder::with_id("about", "About Pandia").build(app)?;
    let check_for_updates =
        MenuItemBuilder::with_id("check_for_updates", "Check for Updates...").build(app)?;

    #[cfg(target_os = "macos")]
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

    let new_file = MenuItemBuilder::with_id("new_file", "New File")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_file = MenuItemBuilder::with_id("open_file", "Open File...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let recent_files_menu = {
        let mut builder = SubmenuBuilder::new(app, "Open Recent");
        if recents.is_empty() {
            let no_recent = MenuItemBuilder::with_id("no_recent", "No Recent Files")
                .enabled(false)
                .build(app)?;
            builder.item(&no_recent).build()?
        } else {
            let mut items = Vec::with_capacity(recents.len());
            for r in recents {
                items.push(
                    MenuItemBuilder::with_id(format!("recent::{}", r.path), &r.name).build(app)?,
                );
            }
            for it in &items {
                builder = builder.item(it);
            }
            let clear_recent =
                MenuItemBuilder::with_id("clear_recent_files", "Clear Recent Files").build(app)?;
            builder.separator().item(&clear_recent).build()?
        }
    };

    let save_file = MenuItemBuilder::with_id("save_file", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save_as", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let export_doc = MenuItemBuilder::with_id("export_doc", "Export...")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let new_tab = MenuItemBuilder::with_id("new_tab", "New Tab")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let next_tab = MenuItemBuilder::with_id("next_tab", "Next Tab")
        .accelerator("CmdOrCtrl+Shift+]")
        .build(app)?;
    let prev_tab = MenuItemBuilder::with_id("prev_tab", "Previous Tab")
        .accelerator("CmdOrCtrl+Shift+[")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_tab)
        .item(&new_file)
        .item(&open_file)
        .item(&recent_files_menu)
        .separator()
        .item(&save_file)
        .item(&save_as)
        .item(&export_doc)
        .separator()
        .item(&next_tab)
        .item(&prev_tab)
        .item(&close_tab)
        .build()?;

    let undo = MenuItemBuilder::with_id("undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo = MenuItemBuilder::with_id("redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let find = MenuItemBuilder::with_id("find", "Find...")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let find_next = MenuItemBuilder::with_id("find_next", "Find Next")
        .accelerator("CmdOrCtrl+G")
        .build(app)?;
    let find_prev = MenuItemBuilder::with_id("find_prev", "Find Previous")
        .accelerator("CmdOrCtrl+Shift+G")
        .build(app)?;
    let find_replace = MenuItemBuilder::with_id("find_replace", "Find and Replace...")
        .accelerator("CmdOrCtrl+H")
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
        .item(&find_next)
        .item(&find_prev)
        .item(&find_replace)
        .build()?;

    let command_palette = MenuItemBuilder::with_id("command_palette", "Command Palette...")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
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
    let toggle_graph_view = MenuItemBuilder::with_id("toggle_graph_view", "Graph View")
        .accelerator("CmdOrCtrl+4")
        .build(app)?;
    let open_settings = MenuItemBuilder::with_id("open_settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&command_palette)
        .separator()
        .item(&toggle_sidebar)
        .separator()
        .item(&toggle_tree_view)
        .item(&toggle_code_view)
        .item(&toggle_form_view)
        .item(&toggle_graph_view)
        .separator()
        .item(&open_settings)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some("Toggle Fullscreen"),
        )?)
        .build()?;

    let validate_json_item = MenuItemBuilder::with_id("validate_json", "Validate JSON")
        .accelerator("CmdOrCtrl+Shift+V")
        .build(app)?;
    let compare_files = MenuItemBuilder::with_id("compare_files", "Compare Files")
        .accelerator("CmdOrCtrl+D")
        .build(app)?;

    let tools_menu = SubmenuBuilder::new(app, "Tools")
        .item(&validate_json_item)
        .separator()
        .item(&compare_files)
        .build()?;

    let keyboard_shortcuts = MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let view_modes_help = MenuItemBuilder::with_id("view_modes_help", "View Modes").build(app)?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&keyboard_shortcuts)
        .item(&view_modes_help)
        .separator()
        .item(&about)
        .item(&check_for_updates)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Exit"))?)
        .build()?;

    #[cfg(target_os = "macos")]
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&keyboard_shortcuts)
        .item(&view_modes_help)
        .build()?;

    #[cfg(target_os = "macos")]
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

    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[&file_menu, &edit_menu, &view_menu, &tools_menu, &help_menu],
    )?;

    Ok(menu)
}

#[tauri::command]
fn refresh_recent_files(app: AppHandle, items: Vec<RecentFile>) -> Result<(), String> {
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        if let Ok(menu) = build_menu(&app2, &items) {
            let _ = app2.set_menu(menu);
        }
    })
    .map_err(|e| e.to_string())
}

fn handle_menu_event(app: &tauri::AppHandle, event: MenuEvent) {
    let menu_id = event.id().as_ref();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("menu-event", menu_id);
    }
}
