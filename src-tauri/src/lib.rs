mod cli;
mod commands;
pub(crate) mod doc;
mod shell_command;
mod shortcuts;

use cli::PendingFile;

use serde::{Deserialize, Serialize};
use std::io::IsTerminal;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuEvent, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, RunEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub(crate) struct RecentFile {
    pub path: String,
    pub name: String,
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            commands::doc_open,
            commands::doc_close,
            commands::doc_get_slice,
            commands::doc_get_value,
            commands::doc_get_rows,
            commands::doc_get_rows_sorted,
            commands::doc_get_rows_filtered,
            commands::doc_column_values,
            commands::doc_get_rows_at,
            commands::doc_get_column,
            commands::doc_summary,
            commands::doc_child_count,
            commands::doc_column_schema,
            commands::doc_scan_columns,
            commands::doc_apply_op,
            commands::doc_set_root_text,
            commands::doc_undo,
            commands::doc_redo,
            commands::doc_diff,
            commands::doc_diff_lines,
            commands::doc_get_lines,
            commands::doc_canonical_text,
            commands::doc_canonical_offsets,
            commands::doc_search,
            commands::cancel_job,
            commands::doc_replace,
            commands::doc_validate_schema,
            commands::read_schema_file,
            commands::doc_generate_types,
            commands::doc_history,
            commands::doc_save,
            commands::doc_backup,
            commands::doc_backup_clear,
            commands::doc_backup_scan,
            commands::doc_export,
            commands::doc_export_preview,
            commands::doc_export_to_file,
            refresh_recent_files,
            drain_pending_files,
            cli_wait_done,
            commands::cli_reply,
            cli_discard_piped,
            shell_command::shell_command_status,
            shell_command::shell_command_install,
            shell_command::shell_command_remove,
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .disable_serde_phases()
        .dangerously_cast_bigints_to_number()
        .constant("LINE_FETCH_MAX", doc::linediff::LINE_FETCH_MAX)
        .constant("EDIT_SIZE_LIMIT", doc::document::EDIT_SIZE_LIMIT)
        .constant("MAX_DOC_BYTES", doc::document::MAX_DOC_BYTES)
        .constant("SHORTCUTS", shortcuts::SHORTCUTS)
}

pub(crate) struct AppState {
    pub pending_files: Mutex<Vec<PendingFile>>,
    pub handoffs: cli::Handoffs,
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

    queue_files(
        app,
        supported_paths.into_iter().map(PendingFile::file).collect(),
    );
}

fn queue_files(app: &AppHandle, files: Vec<PendingFile>) {
    if files.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = state.pending_files.lock() {
            pending.extend(files);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("file-open", &());
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
const RUNTIME_STACK_BYTES: usize = if cfg!(debug_assertions) { 256 } else { 32 } << 20;

fn doc_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(RUNTIME_STACK_BYTES)
        .build()
        .expect("failed to start the async runtime")
}

pub fn run() {
    let context = tauri::generate_context!();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let launched = std::env::var_os(cli::LAUNCHED_ENV).is_some();
    let in_terminal = !cfg!(debug_assertions)
        && !launched
        && (cli::attach_console() || std::io::stderr().is_terminal());
    if (!args.is_empty() || in_terminal) && !launched {
        std::process::exit(cli::launch(args, &context.config().identifier));
    }

    let runtime = doc_runtime();
    tauri::async_runtime::set(runtime.handle().clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let files = cli::pending_from(
                args.into_iter().skip(1),
                std::path::Path::new(&cwd),
                &app.state::<AppState>().handoffs,
            );
            queue_files(app, files);
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            pending_files: Mutex::new(Vec::new()),
            handoffs: cli::Handoffs::default(),
        })
        .manage(std::sync::Arc::new(doc::store::DocStore::new()))
        .manage(std::sync::Arc::new(doc::jobs::JobRegistry::default()))
        .invoke_handler(specta_builder().invoke_handler())
        .setup(move |app| {
            cli::hold_instance(&app.config().identifier);
            let cwd = std::env::current_dir().unwrap_or_default();
            let files = cli::pending_from(args, &cwd, &app.state::<AppState>().handoffs);
            queue_files(app.handle(), files);

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
        .build(context)
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
            if let RunEvent::Exit = event {
                app.state::<AppState>().handoffs.finish_all();
            }
        });
}

fn item(app: &tauri::AppHandle, id: &str, label: &str) -> tauri::Result<MenuItem<tauri::Wry>> {
    let builder = MenuItemBuilder::with_id(id, label);
    match shortcuts::accelerator(id) {
        Some(keys) => builder.accelerator(keys).build(app),
        None => builder.build(app),
    }
}

fn build_menu(
    app: &tauri::AppHandle,
    recents: &[RecentFile],
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let about = item(app, "app.about", "About Pandia")?;
    let check_for_updates = item(app, "app.checkForUpdates", "Check for Updates...")?;

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

    let new_file = item(app, "doc.new", "New File")?;
    let open_file = item(app, "doc.openFile", "Open File...")?;

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
            let clear_recent = item(app, "doc.clearRecents", "Clear Recent Files")?;
            builder.separator().item(&clear_recent).build()?
        }
    };

    let save_file = item(app, "doc.save", "Save")?;
    let save_as = item(app, "doc.saveAs", "Save As...")?;
    let export_doc = item(app, "doc.export", "Export...")?;
    let new_tab = item(app, "tab.new", "New Tab")?;
    let close_tab = item(app, "tab.close", "Close Tab")?;
    let next_tab = item(app, "tab.next", "Next Tab")?;
    let prev_tab = item(app, "tab.prev", "Previous Tab")?;

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
        .item(&close_tab);

    #[cfg(not(target_os = "macos"))]
    let file_menu = file_menu
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Exit"))?);

    let file_menu = file_menu.build()?;

    let undo = item(app, "doc.undo", "Undo")?;
    let redo = item(app, "doc.redo", "Redo")?;
    let find = item(app, "find.open", "Find...")?;
    let find_next = item(app, "find.next", "Find Next")?;
    let find_prev = item(app, "find.prev", "Find Previous")?;
    let find_replace = item(app, "find.replace", "Find and Replace...")?;
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

    let command_palette = item(app, "palette.toggle", "Command Palette...")?;
    let toggle_sidebar = item(app, "view.toggleSidebar", "Toggle Sidebar")?;
    let toggle_tree_view = item(app, "view.tree", "Tree View")?;
    let toggle_code_view = item(app, "view.code", "Code View")?;
    let toggle_form_view = item(app, "view.grid", "Grid View")?;
    let toggle_graph_view = item(app, "view.graph", "Graph View")?;
    let settings_appearance = item(app, "nav.settings", "Appearance")?;
    let settings_behavior = item(app, "nav.settings.behavior", "Behavior")?;
    let settings_layout = item(app, "nav.settings.layout", "Layout")?;
    let settings_data = item(app, "nav.settings.data", "Data")?;
    let settings_about = item(app, "nav.settings.about", "About")?;
    let settings_menu = SubmenuBuilder::new(app, "Settings")
        .item(&settings_appearance)
        .item(&settings_behavior)
        .item(&settings_layout)
        .item(&settings_data)
        .item(&settings_about)
        .build()?;

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
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some("Toggle Fullscreen"),
        )?)
        .build()?;

    let validate_json_item = item(app, "view.openSchemaPanel", "Validate JSON")?;
    let compare_files = item(app, "compare.pick", "Compare Files")?;

    let tools_menu = SubmenuBuilder::new(app, "Tools")
        .item(&validate_json_item)
        .separator()
        .item(&compare_files)
        .build()?;

    let whats_new = item(app, "help.whatsNew", "What's New")?;
    let keyboard_shortcuts = item(app, "help.shortcuts", "Keyboard Shortcuts")?;
    let view_website = item(app, "help.website", "View Website")?;
    let join_discussions = item(app, "help.discussions", "Join Discussions…")?;
    let report_issue = item(app, "help.reportIssue", "Report Issue…")?;
    let send_feedback = item(app, "help.feedback", "Send Feedback…")?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&whats_new)
        .item(&keyboard_shortcuts)
        .item(&view_website)
        .item(&join_discussions)
        .item(&report_issue)
        .item(&send_feedback)
        .separator()
        .item(&about)
        .item(&check_for_updates)
        .build()?;

    #[cfg(target_os = "macos")]
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&whats_new)
        .item(&keyboard_shortcuts)
        .item(&view_website)
        .item(&join_discussions)
        .item(&report_issue)
        .item(&send_feedback)
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
            &settings_menu,
            &help_menu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        app,
        &[
            &file_menu,
            &edit_menu,
            &view_menu,
            &tools_menu,
            &settings_menu,
            &help_menu,
        ],
    )?;

    Ok(menu)
}

#[tauri::command]
#[specta::specta]
fn drain_pending_files(state: tauri::State<'_, AppState>) -> Result<Vec<PendingFile>, String> {
    let mut pending = state.pending_files.lock().map_err(|e| e.to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
#[specta::specta]
fn cli_wait_done(state: tauri::State<'_, AppState>, id: String, report: cli::TabReport) {
    state.handoffs.release(&id, report);
}

#[tauri::command]
#[specta::specta]
fn cli_discard_piped(state: tauri::State<'_, AppState>, path: String) {
    state.handoffs.discard_piped(&path);
}

#[tauri::command]
#[specta::specta]
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

#[cfg(test)]
mod runtime_tests {
    use crate::doc::document::Document;
    use crate::doc::export::ExportFormat;
    use crate::doc::types::Path;

    #[test]
    fn a_thousand_deep_document_fits_on_the_runtime_threads() {
        let text = format!("{}{{\"a\": 1}}{}", "[".repeat(999), "]".repeat(999));
        super::doc_runtime().block_on(async move {
            tokio::task::spawn_blocking(move || {
                let doc = Document::from_text(&text, None).unwrap();
                let root = doc.get_value(&Path::root()).unwrap();
                doc.canonical_lines().unwrap();
                for format in [ExportFormat::Json, ExportFormat::Yaml, ExportFormat::Xml] {
                    doc.export(format).unwrap();
                }
                let never = crate::doc::jobs::CancelFlag::never();
                crate::doc::diff::compute_diff(&root, &root, &never).unwrap();
            })
            .await
            .unwrap();
        });
    }
}

#[cfg(test)]
mod bindings_export {
    #[test]
    fn export_typescript_bindings() {
        super::specta_builder()
            .export(
                specta_typescript::Typescript::default().header(
                    "// Generated by tauri-specta (`cargo test` in src-tauri). Do not edit by hand.\n",
                ),
                "../src/lib/ipc/bindings.ts",
            )
            .expect("failed to export typescript bindings");
    }
}
