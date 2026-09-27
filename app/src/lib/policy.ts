// What may leave the phone:
//   never     notes, names, phone numbers
//   registry  structured household record, to the health registry
//   signal    anonymous symptom signal, to district surveillance
//   urgent    anonymous danger-sign signal, sent first
import lexicon from "../../../data/lexicon.json";
import { isoWeek } from "./time";
import type { SyncClass, Visit } from "./types";
import type { Tagging } from "./tagger";

const SIGNAL_WORDS = lexicon.signal_words as Record<string, string>;

export function visitSyncClass(t: Tagging): SyncClass {
  if (t.danger) return "urgent";
  return t.syndromes.length ? "signal" : "never";
}

// Signals are embedded from this fixed sentence, never from the note.
export function signalSentence(syndromes: string[], ageBand: string): string {
  const words = syndromes.map((s) => SIGNAL_WORDS[s] ?? s).join(", ");
  return `${words} | age ${ageBand}`;
}

export interface Signal {
  id: string;
  village: string;
  week: string;
  date?: string;
  age_band: string;
  sex: string;
  syndromes: string[];
  danger: boolean;
  sentence: string;
  vector_q8?: { s: number; b: string };
}


export function quantize(v: number[]): { s: number; b: string } {
  const s = Math.max(...v.map(Math.abs)) || 1;
  const bytes = new Int8Array(v.map((x) => Math.round((x / s) * 127)));
  let bin = "";
  for (const byte of new Uint8Array(bytes.buffer)) bin += String.fromCharCode(byte);
  return { s, b: btoa(bin) };
}

// Random id (unlinkable to the visit), week instead of date (danger signs keep the date).
export function buildSignal(v: Visit, vector?: number[]): Signal {
  return {
    id: crypto.randomUUID(),
    village: v.village,
    week: isoWeek(v.visit_at),
    ...(v.danger ? { date: v.visit_at.slice(0, 10) } : {}),
    age_band: v.age_band,
    sex: v.sex,
    syndromes: v.syndromes,
    danger: v.danger,
    sentence: signalSentence(v.syndromes, v.age_band),
    ...(vector ? { vector_q8: quantize(vector) } : {}),
  };
}

export const SYNC_CLASS_INFO: Record<SyncClass, { hi: string; en: string; tone: string }> = {
  never: { hi: "फ़ोन पर ही रहेगा", en: "Stays on phone", tone: "slate" },
  registry: { hi: "स्वास्थ्य रजिस्टर", en: "Health registry", tone: "sky" },
  signal: { hi: "गुमनाम संकेत", en: "Anonymous signal", tone: "teal" },
  urgent: { hi: "तुरंत भेजें", en: "Urgent signal", tone: "rose" },
};
