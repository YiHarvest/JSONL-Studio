pub mod core;
pub mod document;
pub mod lazy_tree;

#[cfg(feature = "desktop")]
mod desktop {
    use super::core::{Page, Session};
    use super::document::{Document, DocumentInfo, Edit, SearchPage};
    use super::lazy_tree::TreePage;
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    use tauri::{Emitter, Manager, State};

    #[derive(Default)]
    struct AppState {
        session: Mutex<Option<Arc<Mutex<Document>>>>,
        pending: Mutex<Vec<String>>,
        recovery: Mutex<PathBuf>,
    }
    fn current(state: &AppState) -> Result<Arc<Mutex<Document>>, String> {
        state
            .session
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("No file open".into())
    }
    #[tauri::command]
    async fn open_file(path: String, state: State<'_, AppState>) -> Result<DocumentInfo, String> {
        let session =
            tauri::async_runtime::spawn_blocking(move || Session::open(PathBuf::from(path)))
                .await
                .map_err(|e| e.to_string())??;
        let document = Document::new(session);
        Document::discard_recovery(&state.recovery.lock().unwrap())?;
        let info = document.info();
        *state.session.lock().map_err(|e| e.to_string())? = Some(Arc::new(Mutex::new(document)));
        Ok(info)
    }
    #[tauri::command]
    async fn import_text(text: String, state: State<'_, AppState>) -> Result<DocumentInfo, String> {
        let session = tauri::async_runtime::spawn_blocking(move || Session::import(text))
            .await
            .map_err(|e| e.to_string())??;
        let document = Document::new(session);
        document.checkpoint(&state.recovery.lock().unwrap())?;
        let info = document.info();
        *state.session.lock().map_err(|e| e.to_string())? = Some(Arc::new(Mutex::new(document)));
        Ok(info)
    }
    #[tauri::command]
    async fn read_page(
        start: usize,
        count: usize,
        state: State<'_, AppState>,
    ) -> Result<Page, String> {
        let session = current(&state)?;
        tauri::async_runtime::spawn_blocking(move || {
            session
                .lock()
                .map_err(|e| e.to_string())?
                .page(start, count)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn file_changed(state: State<'_, AppState>) -> Result<bool, String> {
        Ok(current(&state)?
            .lock()
            .map_err(|e| e.to_string())?
            .changed())
    }
    #[tauri::command]
    async fn validate_file(state: State<'_, AppState>) -> Result<(usize, usize), String> {
        let session = current(&state)?;
        let document = session.lock().map_err(|e| e.to_string())?.clone();
        tauri::async_runtime::spawn_blocking(move || document.validate())
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn read_tree_node(
        line: usize,
        route: Vec<usize>,
        offset: usize,
        limit: usize,
        state: State<'_, AppState>,
    ) -> Result<TreePage, String> {
        let session = current(&state)?;
        let document = session.lock().map_err(|e| e.to_string())?.clone();
        tauri::async_runtime::spawn_blocking(move || {
            document.tree_page(line, &route, offset, limit)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn edit_record(
        edit: Edit,
        revision: u64,
        state: State<'_, AppState>,
    ) -> Result<DocumentInfo, String> {
        let session = current(&state)?;
        let recovery = state.recovery.lock().unwrap().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut document = session.lock().map_err(|e| e.to_string())?;
            let mut next = document.clone();
            let info = next.edit(edit, revision)?;
            next.checkpoint(&recovery)?;
            *document = next;
            Ok(info)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn save_document(
        path: String,
        overwrite: bool,
        revision: u64,
        state: State<'_, AppState>,
    ) -> Result<DocumentInfo, String> {
        let session = current(&state)?;
        let recovery = state.recovery.lock().unwrap().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut document = session.lock().map_err(|e| e.to_string())?;
            let info = document.save(PathBuf::from(path), overwrite, revision)?;
            // Saving succeeded even if removing an obsolete checkpoint fails.
            let _ = Document::discard_recovery(&recovery);
            Ok(info)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn search_document(
        query: String,
        mode: String,
        start: usize,
        state: State<'_, AppState>,
    ) -> Result<SearchPage, String> {
        let session = current(&state)?;
        // Snapshot edit pieces, then release the document lock for cancellable page scans.
        let document = session.lock().map_err(|e| e.to_string())?.clone();
        tauri::async_runtime::spawn_blocking(move || document.search(&query, &mode, start))
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn recovery_available(state: State<'_, AppState>) -> bool {
        state.recovery.lock().unwrap().exists()
    }
    #[tauri::command]
    async fn restore_document(state: State<'_, AppState>) -> Result<DocumentInfo, String> {
        let recovery = state.recovery.lock().unwrap().clone();
        let document = tauri::async_runtime::spawn_blocking(move || Document::restore(&recovery))
            .await
            .map_err(|e| e.to_string())??;
        let info = document.info();
        *state.session.lock().map_err(|e| e.to_string())? = Some(Arc::new(Mutex::new(document)));
        Ok(info)
    }
    #[tauri::command]
    fn discard_recovery(state: State<'_, AppState>) -> Result<(), String> {
        Document::discard_recovery(&state.recovery.lock().unwrap())
    }
    #[tauri::command]
    fn pending_files(state: State<'_, AppState>) -> Vec<String> {
        std::mem::take(&mut *state.pending.lock().unwrap())
    }
    fn queue(app: &tauri::AppHandle, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        app.state::<AppState>()
            .pending
            .lock()
            .unwrap()
            .extend(paths);
        let _ = app.emit("files-opened", ());
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
    pub fn run() {
        let app = tauri::Builder::default()
            .manage(AppState::default())
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                let paths = args
                    .into_iter()
                    .skip(1)
                    .filter(|a| !a.starts_with('-'))
                    .map(|p| {
                        let path = PathBuf::from(&p);
                        if path.is_absolute() {
                            p
                        } else {
                            PathBuf::from(&cwd)
                                .join(path)
                                .to_string_lossy()
                                .into_owned()
                        }
                    })
                    .collect();
                queue(app, paths);
            }))
            .plugin(tauri_plugin_dialog::init())
            .setup(|app| {
                *app.state::<AppState>().recovery.lock().unwrap() =
                    app.path().app_local_data_dir()?.join("recovery.json");
                let paths = std::env::args()
                    .skip(1)
                    .filter(|p| !p.starts_with('-'))
                    .collect();
                queue(app.handle(), paths);
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                open_file,
                import_text,
                read_page,
                file_changed,
                validate_file,
                read_tree_node,
                pending_files,
                edit_record,
                save_document,
                search_document,
                recovery_available,
                restore_document,
                discard_recovery
            ])
            .build(tauri::generate_context!())
            .expect("Failed to build JSONL Studio");
        app.run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                queue(
                    _app,
                    urls.into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect(),
                );
            }
        });
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
