mod runtime_control;
mod runtime_envelope;
mod runtime_supervisor;
#[cfg(unix)]
mod unix_watchdog;

use tauri::{Manager, RunEvent, State};

use crate::{
    runtime_control::RuntimeHostShutdownReason,
    runtime_supervisor::{
        ExitDisposition, RuntimeConnectionDescriptor, RuntimeSupervisor, bundled_renderer_origin,
        renderer_origin_for_window,
    },
};

const DESKTOP_RUNTIME_BRIDGE: &str = r#"
(() => {
  if (window.location.origin !== "tauri://localhost" && window.location.origin !== "http://tauri.localhost") return;
  const internals = window.__TAURI_INTERNALS__;
  const invoke = internals.invoke.bind(internals);
  Object.defineProperty(window, "workbenchDesktop", {
    configurable: false,
    enumerable: true,
    value: Object.freeze({
      runtime: Object.freeze({
        bootstrap: () => invoke("runtime_bootstrap", {}),
      }),
      lifecycle: Object.freeze({
        restartRuntime: () => invoke("runtime_restart", {}),
      }),
    }),
    writable: false,
  });
})();
"#;

#[cfg(unix)]
pub fn private_mode_exit_code() -> Option<i32> {
    unix_watchdog::private_mode_exit_code()
}

#[cfg(not(unix))]
pub fn private_mode_exit_code() -> Option<i32> {
    None
}

#[tauri::command]
async fn runtime_bootstrap(
    window: tauri::WebviewWindow,
    supervisor: State<'_, RuntimeSupervisor>,
) -> Result<RuntimeConnectionDescriptor, String> {
    let origin = renderer_origin_for_window(&window).map_err(|error| error.to_string())?;
    supervisor
        .bootstrap(origin)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn runtime_restart(
    window: tauri::WebviewWindow,
    supervisor: State<'_, RuntimeSupervisor>,
) -> Result<(), String> {
    let origin = renderer_origin_for_window(&window).map_err(|error| error.to_string())?;
    supervisor
        .restart(origin)
        .await
        .map_err(|error| error.to_string())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let supervisor = RuntimeSupervisor::new(app.handle().clone());
            tauri::async_runtime::block_on(
                supervisor.bootstrap(bundled_renderer_origin().to_owned()),
            )
            .map_err(|error| {
                std::io::Error::other(format!("Runtime Host startup failed: {error}"))
            })?;
            app.manage(supervisor);

            let mut main_configs = app
                .config()
                .app
                .windows
                .iter()
                .filter(|config| config.label == "main");
            let main_config = main_configs
                .next()
                .cloned()
                .ok_or_else(|| std::io::Error::other("missing main window configuration"))?;
            if main_configs.next().is_some() || main_config.create {
                return Err(std::io::Error::other(
                    "main window configuration must be unique and manually created",
                )
                .into());
            }
            tauri::WebviewWindowBuilder::from_config(app, &main_config)?
                .initialization_script(DESKTOP_RUNTIME_BRIDGE)
                .on_document_title_changed(|window, title| {
                    if window.set_title(&title).is_err() {
                        window.app_handle().exit(1);
                    }
                })
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_bootstrap, runtime_restart])
        .build(tauri::generate_context!())
        .expect("failed to build Pi Workbench");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            let supervisor = app.state::<RuntimeSupervisor>();
            match supervisor.exit_disposition() {
                ExitDisposition::StartShutdown => {
                    api.prevent_exit();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let supervisor = app.state::<RuntimeSupervisor>();
                        let exit_code = if supervisor
                            .shutdown(RuntimeHostShutdownReason::ContainerExit)
                            .await
                            .is_ok()
                        {
                            code.unwrap_or(0)
                        } else {
                            1
                        };
                        supervisor.allow_exit();
                        app.exit(exit_code);
                    });
                }
                ExitDisposition::WaitForShutdown => api.prevent_exit(),
                ExitDisposition::AllowExit => {}
            }
        }
    });
}
