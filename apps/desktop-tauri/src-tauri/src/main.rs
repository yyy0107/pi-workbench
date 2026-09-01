fn main() {
    if let Some(exit_code) = workbench_desktop_tauri::private_mode_exit_code() {
        std::process::exit(exit_code);
    }
    workbench_desktop_tauri::run();
}
