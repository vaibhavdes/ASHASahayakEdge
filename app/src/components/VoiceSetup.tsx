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
          <Badge tone="amber">not available</Badge>
        ) : status.onDevice && status.languageInstalled === "installed" ? (
          <Badge tone="emerald">
            <ShieldCheck size={12} /> offline, on phone
          </Badge>
        ) : status.languageInstalled === "downloading" ? (
          <Badge tone="sky">downloading</Badge>
        ) : (
          <Badge tone={ready ? "teal" : "amber"}>{isNative ? "needs Hindi pack" : "browser (testing)"}</Badge>
        )}
      </div>
      <p className="text-xs text-slate-600">
        {isNative
          ? status?.onDevice
            ? "Speech is turned into text on this phone. Audio never leaves it."
            : "This phone has no on-device recogniser; the app asks Android to prefer its offline voice models."
          : "In a browser the Web Speech API is used, only for testing screens."}
      </p>
      {isNative && needsPack && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            const r = await downloadHindiVoice().catch((e) => ({ started: false, error: String(e) }) as never);
            setMsg(r.started ? "Download started. It needs Wi-Fi once." : "Opened voice settings: add Hindi under offline speech recognition.");
            setTimeout(reload, 4000);
          }}
        >
          <Download size={18} /> हिंदी ऑफ़लाइन आवाज़ डाउनलोड करें · Get offline Hindi voice
        </Button>
      )}
      <p className="flex items-start gap-1 text-xs text-slate-500">
        <Mic size={12} className="mt-0.5 shrink-0" /> The mic on the Gboard keyboard also works in every text box.
      </p>
      {msg && <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-900">{msg}</p>}
    </Card>
  );
}
