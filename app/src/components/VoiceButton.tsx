import { tr } from "../lib/i18n";
import { Mic, Square } from "lucide-react";
import { useState } from "react";
import { listen, stopListening, type VoiceEvent } from "../lib/voice";
import { cx } from "./ui";

export function VoiceButton({ onText, compact = false }: { onText: (text: string) => void; compact?: boolean }) {
  const [state, setState] = useState<"idle" | VoiceEvent["state"]>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setPartial("");
    setState("listening");
    try {
      const text = await listen((e) => {
        if (e.state) setState(e.state);
        if (e.partial) setPartial(e.partial);
      });
      if (text) onText(text);
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    } finally {
      setState("idle");
      setPartial("");
    }
  }

  const busy = state !== "idle";
  if (compact) {
    return (
      <button
        type="button"
        onClick={busy ? stopListening : start}
        aria-label={tr("बोलकर लिखें", "speak")}
        className={cx("flex min-h-12 min-w-12 items-center justify-center rounded-xl", busy ? "animate-pulse bg-rose-600 text-white" : "bg-teal-50 text-teal-800 ring-1 ring-teal-200")}
      >
        {busy ? <Square size={18} /> : <Mic size={22} />}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={busy ? stopListening : start}
        className={cx(
          "flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold transition",
          busy ? "animate-pulse bg-rose-600 text-white" : "bg-teal-700 text-white active:bg-teal-800",
        )}
      >
        {busy ? <Square size={24} /> : <Mic size={28} />}
        {busy ? (state === "processing" ? tr("समझ रहे हैं…", "processing") : tr("बोलिए…", "listening")) : tr("बोलकर लिखें", "Speak")}
      </button>
      {busy && partial && <p className="rounded-xl bg-teal-50 p-2 text-base text-teal-900">{partial}</p>}
      {error && <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{error}</p>}
    </div>
  );
}
