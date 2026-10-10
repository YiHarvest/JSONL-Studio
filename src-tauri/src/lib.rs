pub mod core;

#[cfg(feature = "desktop")]
mod desktop {
    use super::core::{Info, Page, Session};
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    use tauri::{Emitter, Manager, State};

    #[derive(Default)]
    struct AppState {
        session: Mutex<Option<Arc<Session>>>,
        pending: Mutex<Vec<String>>,
    }
    fn current(state: &AppState) -> Result<Arc<Session>, String> {
        state
            .session
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("No file open".into())
    }
    #[tauri::command]
    async fn open_file(path: String, state: State<'_, AppState>) -> Result<Info, String> {
        let session =
            tauri::async_runtime::spawn_blocking(move || Session::open(PathBuf::from(path)))
                .await
                .map_err(|e| e.to_string())??;
        let info = session.info.clone();
        *state.session.lock().map_err(|e| e.to_string())? = Some(Arc::new(session));
        Ok(info)
    }
    #[tauri::command]
    async fn import_text(text: String, state: State<'_, AppState>) -> Result<Info, String> {
        let session = tauri::async_runtime::spawn_blocking(move || Session::import(text))
            .await
            .map_err(|e| e.to_string())??;
        let info = session.info.clone();
        *state.session.lock().map_err(|e| e.to_string())? = Some(Arc::new(session));
        Ok(info)
    }
    #[tauri::command]
    async fn read_page(
        start: usize,
        count: usize,
        state: State<'_, AppState>,
    ) -> Result<Page, String> {
        let session = current(&state)?;
        tauri::async_runtime::spawn_blocking(move || session.page(start, count))
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn file_changed(state: State<'_, AppState>) -> Result<bool, String> {
        Ok(current(&state)?.changed())
    }
    #[tauri::command]
    async fn validate_file(state: State<'_, AppState>) -> Result<(usize, usize), String> {
        let session = current(&state)?;
        tauri::async_runtime::spawn_blocking(move || session.validate())
            .await
            .map_err(|e| e.to_string())?
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
                pending_files
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
