import { tr } from "../lib/i18n";
import { Download, Mic, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { isNative } from "../lib/bridge";
import { useData } from "../lib/hooks";
import { downloadHindiVoice, voiceStatus } from "../lib/voice";
import { Badge, Bi, Button, Card } from "./ui";

export function VoiceSetup() {
  const { data: status, reload } = useData(() => voiceStatus().catch(() => null), []);
  const [msg, setMsg] = useState<string | null>(null);

  const ready = status?.available && (status.languageInstalled === "installed" || (!status.onDevice && status.languageInstalled === "unknown"));
  const needsPack = status?.onDevice && ["downloadable", "unknown"].includes(status.languageInstalled);

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Bi hi="बोलकर लिखना" en="Voice input (Hindi)" className="text-sm font-semibold" />
        {!status ? (
          <Badge>…</Badge>
        ) : !status.available ? (
          <Badge tone="amber">{tr("उपलब्ध नहीं", "not available")}</Badge>
        ) : status.onDevice && status.languageInstalled === "installed" ? (
          <Badge tone="emerald">
            <ShieldCheck size={12} /> {tr("बिना इंटरनेट", "works offline")}
          </Badge>
        ) : status.languageInstalled === "downloading" ? (
          <Badge tone="sky">{tr("डाउनलोड हो रहा है", "downloading")}</Badge>
        ) : (
          <Badge tone={ready ? "teal" : "amber"}>{isNative ? tr("हिंदी पैक चाहिए", "needs Hindi pack") : "browser"}</Badge>
        )}
      </div>
      <p className="text-xs text-slate-600">
        {isNative
          ? status?.onDevice
            ? tr("आवाज़ इसी फ़ोन पर लिखी जाती है, कहीं भेजी नहीं जाती।", "Speech is turned into text on this phone. Audio never leaves it.")
            : tr("बोलकर लिखने के लिए फ़ोन की हिंदी आवाज़ इस्तेमाल होगी।", "The phone's own Hindi voice typing is used.")
          : tr("ब्राउज़र में सिर्फ़ जांच के लिए।", "In a browser, for testing screens only.")}
      </p>
      {isNative && needsPack && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            const r = await downloadHindiVoice().catch((e) => ({ started: false, error: String(e) }) as never);
            setMsg(r.started ? tr("डाउनलोड शुरू हुआ। एक बार Wi-Fi चाहिए।", "Download started. It needs Wi-Fi once.") : tr("आवाज़ की सेटिंग खुली: ऑफ़लाइन में हिंदी जोड़ें।", "Opened voice settings: add Hindi under offline speech recognition."));
            setTimeout(reload, 4000);
          }}
        >
          <Download size={18} /> {tr("हिंदी ऑफ़लाइन आवाज़ डाउनलोड करें", "Get offline Hindi voice")}
        </Button>
      )}
      <p className="flex items-start gap-1 text-xs text-slate-500">
        <Mic size={12} className="mt-0.5 shrink-0" /> {tr("कीबोर्ड का 🎤 भी हर जगह काम करता है।", "The mic on the keyboard also works in every text box.")}
      </p>
      {msg && <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-900">{msg}</p>}
    </Card>
  );
}
