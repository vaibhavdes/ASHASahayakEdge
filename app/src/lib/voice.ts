// Speech in and out. On the phone: our plugin (Android on-device recogniser + TTS).
// In a browser: the Web Speech API.
import { Channel, invoke } from "@tauri-apps/api/core";
import { isNative } from "./bridge";

export const VOICE_LANG = "hi-IN";

export interface VoiceStatus {
  available: boolean;
  onDevice: boolean;
  permission: string;
  /** "installed" | "downloading" | "downloadable" | "unsupported" | "unknown" */
  languageInstalled: string;
}

export type VoiceEvent = { state?: "listening" | "hearing" | "processing"; partial?: string };

export async function voiceStatus(): Promise<VoiceStatus> {
  if (isNative) return invoke<VoiceStatus>("plugin:voice|status", { lang: VOICE_LANG });
  const available = !!browserRecognition();
  return { available, onDevice: false, permission: "prompt", languageInstalled: available ? "unknown" : "unsupported" };
}

export async function downloadHindiVoice(): Promise<{ started: boolean; openedSettings?: boolean }> {
  if (!isNative) return { started: false };
  return invoke("plugin:voice|download_language", { lang: VOICE_LANG });
}

export async function listen(onEvent: (e: VoiceEvent) => void): Promise<string> {
  if (isNative) {
    const channel = new Channel<VoiceEvent>();
    channel.onmessage = onEvent;
    const res = await invoke<{ text: string }>("plugin:voice|listen", { lang: VOICE_LANG, onPartial: channel });
    return res.text;
  }
  return listenInBrowser(onEvent);
}

export async function stopListening() {
  if (isNative) await invoke("plugin:voice|stop");
  else active?.stop();
}

// ------------------------------ browser fallback ------------------------------

type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: any) => void;
  onerror: (e: any) => void;
  onend: () => void;
  onstart: () => void;
  start: () => void;
  stop: () => void;
};

let active: BrowserRecognition | null = null;

function browserRecognition(): (new () => BrowserRecognition) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function listenInBrowser(onEvent: (e: VoiceEvent) => void): Promise<string> {
  const Ctor = browserRecognition();
  if (!Ctor) return Promise.reject(new Error("Voice input is not supported in this browser"));
  return new Promise((resolve, reject) => {
    const r = new Ctor();
    active = r;
    r.lang = VOICE_LANG;
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onstart = () => onEvent({ state: "listening" });
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      onEvent({ partial: finalText + interim });
    };
    r.onerror = (e: any) => reject(new Error(e.error === "no-speech" ? "Didn't catch that. Please speak again." : `Voice error: ${e.error}`));
    r.onend = () => {
      active = null;
      resolve(finalText.trim());
    };
    r.start();
  });
}

// ------------------------------- read aloud -------------------------------

const speechLang = (text: string) => ((text.match(/[ऀ-ॿ]/g)?.length ?? 0) > text.length * 0.3 ? "hi-IN" : "en-IN");

export async function speakText(text: string): Promise<void> {
  const lang = speechLang(text);
  if (isNative) {
    await invoke("plugin:voice|speak", { text, lang });
    return;
  }
  if (!("speechSynthesis" in window)) throw new Error("Read-aloud is not available here");
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

export async function stopSpeaking(): Promise<void> {
  if (isNative) await invoke("plugin:voice|stop_speaking");
  else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
