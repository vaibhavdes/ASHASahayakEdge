import { CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { Bi, Button, Card, Progress, Segmented, Spinner } from "../components/ui";
import { VoiceSetup } from "../components/VoiceSetup";
import { logActivity } from "../lib/activity";
import { loadModel } from "../lib/embedder";
import { useSettings } from "../lib/hooks";
import { tr, type Lang } from "../lib/i18n";
import { loadStarterKnowledge } from "../lib/starter";
import { updateSettings } from "../lib/settings";
import type { Role } from "../lib/types";
import { VILLAGES } from "../lib/villages";

// Registers this phone with the district server. Returns null when the server asks for a code.
async function enroll(cloudUrl: string, body: { device_id: string; role: Role; village: string; code: string }) {
  const response = await fetch(`${cloudUrl.replace(/\/$/, "")}/v1/enroll`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (response.status === 401) return null;
  if (response.status === 429) throw new Error(tr("इस नेटवर्क से बहुत सारे फ़ोन जुड़ चुके हैं, थोड़ी देर बाद कोशिश करें।", "Too many phones registered from this network. Try again later."));
  if (!response.ok) throw new Error(`Enrollment failed: ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}

export default function Setup() {
  const settings = useSettings();
  const [role, setRole] = useState<Role>("ASHA");
  const [name, setName] = useState("");
  const [village, setVillage] = useState("MDH");
  const [cloudUrl, setCloudUrl] = useState(import.meta.env.VITE_CLOUD_URL || "https://sahayak-cloud-362605925833.asia-south1.run.app");
  const [enrollCode, setEnrollCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [phase, setPhase] = useState<"form" | "working" | "error">("form");
  const [label, setLabel] = useState("");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");

  async function start() {
    setPhase("working");
    setError("");
    try {
      const deviceId = crypto.randomUUID();
      setLabel(tr("फ़ोन जोड़ा जा रहा है", "Registering this phone"));
      const token = await enroll(cloudUrl, { device_id: deviceId, role, village, code: enrollCode.trim() });
      if (!token) {
        setNeedsCode(true);
        setError(enrollCode.trim() ? tr("कोड सही नहीं है।", "The enrollment code is incorrect.") : tr("इस सर्वर को फ़ोन जोड़ने का कोड चाहिए।", "This server needs an enrollment code."));
        setPhase("form");
        return;
      }
      await updateSettings({ deviceId, deviceToken: token, role, name: name.trim() || role, village, cloudUrl, modelSource: "huggingface" });
      setLabel(tr("ऑफ़लाइन AI डाउनलोड हो रहा है (सिर्फ़ एक बार)", "Downloading offline AI (one time only)"));
      await loadModel((p) => setPct(Math.round(p * 0.6)));

      setLabel(tr("स्वास्थ्य जानकारी लोड हो रही है", "Loading health guidance"));
      setPct(62);
      await loadStarterKnowledge();

      await logActivity("system", `Device set up: ${role} in ${village}`);
      // Version 0: the first sync brings the district's current guidance on top of the bundled starter set.
      await updateSettings({ setupDone: true, knowledgeVersion: 0, knowledgeSyncedAt: new Date().toISOString() });
    } catch (e) {
      setError(String(e).includes("Failed to fetch") ? tr("इंटरनेट नहीं मिला। पहली बार सेटअप के लिए इंटरनेट चाहिए।", "No internet. First-time setup needs internet once.") : String(e));
      setPhase("error");
    }
  }

  if (phase !== "form") {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
        <img src="/icon.svg" className="mx-auto h-16 w-16" alt="" />
        {phase === "working" ? (
          <Card className="space-y-3">
            <div className="flex items-center gap-2 font-semibold text-teal-800">
              <Spinner /> {tr("तैयारी हो रही है", "Setting up")}
            </div>
            <div className="text-sm text-slate-600">{label}</div>
            <Progress value={pct} />
            <p className="text-xs text-slate-500">{tr("इसके बाद सब कुछ बिना इंटरनेट के चलेगा।", "After this, everything works without internet.")}</p>
          </Card>
        ) : (
          <Card className="space-y-3">
            <div className="font-semibold text-rose-700">{tr("सेटअप नहीं हो पाया", "Setup failed")}</div>
            <p className="whitespace-pre-wrap text-sm text-slate-600">{error}</p>
            <Button onClick={() => setPhase("form")}>{tr("फिर से", "Try again")}</Button>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-md space-y-4 overflow-y-auto p-5">
      <div className="flex items-center gap-3 pt-4">
        <img src="/icon.svg" className="h-12 w-12" alt="" />
        <div>
          <h1 className="text-xl font-bold text-teal-900">Sahayak Edge</h1>
          <p className="text-sm text-slate-600">{tr("आपकी ऑफ़लाइन स्वास्थ्य डायरी", "Your offline health memory")}</p>
        </div>
      </div>

      <Segmented<Lang> value={settings?.lang ?? "hi"} onChange={(lang) => updateSettings({ lang })} options={[{ value: "hi", label: "हिंदी" }, { value: "en", label: "English" }]} />

      <Card className="space-y-4">
        <label className="block space-y-1">
          <Bi hi="आप कौन हैं?" en="Your role" className="text-sm font-semibold" />
          <Segmented<Role> value={role} onChange={setRole} options={[{ value: "ASHA", label: "ASHA" }, { value: "ANM", label: tr("ANM (सुपरवाइज़र)", "ANM (supervisor)") }]} />
        </label>
        <label className="block space-y-1">
          <Bi hi="नाम" en="Name" className="text-sm font-semibold" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunita" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
        </label>
        <label className="block space-y-1">
          <Bi hi="क्षेत्र" en="Assigned area" className="text-sm font-semibold" />
          <select value={village} onChange={(e) => setVillage(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
            {VILLAGES.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {needsCode && (
          <label className="block space-y-1">
            <Bi hi="फ़ोन जोड़ने का कोड" en="Enrollment code" className="text-sm font-semibold" />
            <input value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} autoCapitalize="off" autoCorrect="off" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-base" />
          </label>
        )}
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">{tr("उन्नत: ज़िला सर्वर", "Advanced: district server")}</summary>
          <input value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm" />
        </details>
      </Card>

      <VoiceSetup />

      <Button className="w-full" disabled={needsCode && !enrollCode.trim()} onClick={start}>
        <Download size={20} /> {tr("शुरू करें", "Set up this phone")}
      </Button>
      <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-teal-700" />
        {tr(
          "पहली बार इंटरनेट चाहिए। विज़िट नोट इसी फ़ोन पर रहते हैं; परिवार की जानकारी सिर्फ़ आपके क्षेत्र के फ़ोन से सिंक होती है।",
          "Needs internet once. Visit notes stay on this phone; family details sync only with phones in your area.",
        )}
      </p>
    </div>
  );
}
