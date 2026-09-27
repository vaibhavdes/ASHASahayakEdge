//! Android speech-to-text (on-device recogniser where available) and text-to-speech.

use serde::Serialize;
use serde_json::Value;
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.sahayak.voice";

struct Voice<R: Runtime>(#[allow(dead_code)] Option<tauri::plugin::PluginHandle<R>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenPayload {
    lang: String,
    on_partial: Channel<Value>,
}

#[derive(Serialize)]
struct LangPayload {
    lang: String,
}

#[derive(Serialize)]
struct SpeakPayload {
    text: String,
    lang: String,
}

fn call<R: Runtime, P: Serialize>(app: &AppHandle<R>, command: &str, payload: P) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let voice = app.state::<Voice<R>>();
        let handle = voice.0.as_ref().ok_or("voice plugin not registered")?;
        handle
            .run_mobile_plugin::<Value>(command, payload)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command, payload);
        Err("voice input is available in the Android app".into())
    }
}

#[tauri::command]
async fn status<R: Runtime>(app: AppHandle<R>, lang: String) -> Result<Value, String> {
    call(&app, "status", LangPayload { lang })
}

#[tauri::command]
async fn listen<R: Runtime>(app: AppHandle<R>, lang: String, on_partial: Channel<Value>) -> Result<Value, String> {
    call(&app, "listen", ListenPayload { lang, on_partial })
}

#[tauri::command]
async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    call(&app, "stop", serde_json::json!({}))
}

#[tauri::command]
async fn download_language<R: Runtime>(app: AppHandle<R>, lang: String) -> Result<Value, String> {
    call(&app, "downloadLanguage", LangPayload { lang })
}

#[tauri::command]
async fn speak<R: Runtime>(app: AppHandle<R>, text: String, lang: String) -> Result<Value, String> {
    call(&app, "speak", SpeakPayload { text, lang })
}

#[tauri::command]
async fn stop_speaking<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    call(&app, "stopSpeaking", serde_json::json!({}))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("voice")
        .invoke_handler(tauri::generate_handler![status, listen, stop, download_language, speak, stop_speaking])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = Some(api.register_android_plugin(PLUGIN_IDENTIFIER, "VoicePlugin")?);
            #[cfg(not(target_os = "android"))]
            let handle = {
                let _ = api;
                None
            };
            app.manage(Voice::<R>(handle));
            Ok(())
        })
        .build()
}
