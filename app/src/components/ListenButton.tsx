import { tr } from "../lib/i18n";
import { Square, Volume2 } from "lucide-react";
import { useState } from "react";
import { speakText, stopSpeaking } from "../lib/voice";
import { cx } from "./ui";

export function ListenButton({ text, className }: { text: string; className?: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (on) {
          await stopSpeaking().catch(() => undefined);
          setOn(false);
          return;
        }
        setOn(true);
        try {
          await speakText(text);
        } catch {
          setOn(false);
        }
        // The native call returns when speech starts, so reset after roughly its length.
        setTimeout(() => setOn(false), Math.min(60_000, 2_000 + text.length * 70));
      }}
      className={cx("inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold ring-1", on ? "bg-teal-700 text-white ring-teal-700" : "bg-white text-teal-800 ring-teal-200", className)}
    >
      {on ? <Square size={14} /> : <Volume2 size={16} />} {on ? tr("रोकें", "Stop") : tr("सुनें", "Listen")}
    </button>
  );
}
