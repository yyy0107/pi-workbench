fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["runtime_bootstrap", "runtime_restart"]),
    ))
    .expect("failed to configure the Workbench Tauri application");
}
