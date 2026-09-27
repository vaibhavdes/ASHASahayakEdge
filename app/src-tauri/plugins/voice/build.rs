const COMMANDS: &[&str] = &["status", "listen", "stop", "download_language", "speak", "stop_speaking"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
