import { CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { Bi, Button, Card, Progress, Segmented, Spinner } from "../components/ui";
import { VoiceSetup } from "../components/VoiceSetup";
import { logActivity } from "../lib/activity";
import { loadModel } from "../lib/embedder";
import { loadDemoData, loadStarterKnowledge } from "../lib/seed";
import { updateSettings } from "../lib/settings";
import type { Role } from "../lib/types";
import { VILLAGES } from "../lib/villages";

const DEMO_VILLAGES = ["RMP", "LKP"];

export default function Setup() {
  const [role, setRole] = useState<Role>("ASHA");
  const [name, setName] = useState("");
  const [village, setVillage] = useState("RMP");
  const [cloudUrl, setCloudUrl] = useState(import.meta.env.VITE_CLOUD_URL ?? "http://192.168.1.10:8000");
  const [modelSource, setModelSource] = useState<"huggingface" | "cloud">("huggingface");
  const [demo, setDemo] = useState(true);
  const [phase, setPhase] = useState<"form" | "working" | "error">("form");
  const [label, setLabel] = useState("");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");

  async function start() {
    setPhase("working");
    try {
      const deviceId = crypto.randomUUID();
      await updateSettings({ deviceId, role, name: name.trim() || role, village, cloudUrl, modelSource });
      setLabel("ऑफ़लाइन AI डाउनलोड · Downloading offline AI (one time, ~135 MB)");
      const host = modelSource === "cloud" ? `${cloudUrl.replace(/\/$/, "")}/models/` : undefined;
      await loadModel((p) => setPct(Math.round(p * 0.6)), host);

      setLabel("स्वास्थ्य जानकारी · Loading health guidance");
      setPct(62);
      await loadStarterKnowledge();

      if (demo && DEMO_VILLAGES.includes(village)) {
        await loadDemoData(village as "RMP" | "LKP", role, deviceId, (l, p) => {
          setLabel(l);
          setPct(65 + Math.round(p * 0.35));
        });
      }
      await logActivity("system", `Device set up: ${role} in ${village}`);
      await updateSettings({ setupDone: true, knowledgeVersion: 1, knowledgeSyncedAt: new Date().toISOString() });
    } catch (e) {
      setError(String(e));
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
              <Spinner /> तैयारी हो रही है · Setting up
            </div>
            <div className="text-sm text-slate-600">{label}</div>
            <Progress value={pct} />
            <p className="text-xs text-slate-500">After this, everything works without internet.</p>
          </Card>
        ) : (
          <Card className="space-y-3">
            <div className="font-semibold text-rose-700">Setup failed</div>
            <pre className="whitespace-pre-wrap text-xs text-slate-600">{error}</pre>
            <Button onClick={() => setPhase("form")}>फिर से · Try again</Button>
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
          <p className="text-sm text-slate-600">आपकी ऑफ़लाइन स्वास्थ्य डायरी · Your offline health memory</p>
        </div>
      </div>

      <Card className="space-y-4">
        <label className="block space-y-1">
          <Bi hi="आप कौन हैं?" en="Your role" className="text-sm font-semibold" />
          <Segmented<Role> value={role} onChange={setRole} options={[{ value: "ASHA", label: "ASHA" }, { value: "ANM", label: "ANM (supervisor)" }]} />
        </label>
        <label className="block space-y-1">
          <Bi hi="नाम" en="Name" className="text-sm font-semibold" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunita" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
        </label>
        <label className="block space-y-1">
          <Bi hi="गाँव" en="Village" className="text-sm font-semibold" />
          <select value={village} onChange={(e) => setVillage(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
            {VILLAGES.map((v) => (
              <option key={v.code} value={v.code}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card className="space-y-4">
        <label className="block space-y-1">
          <Bi hi="ज़िला सर्वर" en="District sync server (can change later)" className="text-sm font-semibold" />
          <input value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm" />
        </label>
        <label className="block space-y-1">
          <Bi hi="AI मॉडल कहाँ से" en="Download the AI model from" className="text-sm font-semibold" />
          <Segmented value={modelSource} onChange={setModelSource} options={[{ value: "huggingface", label: "Hugging Face" }, { value: "cloud", label: "District server" }]} />
        </label>
        {DEMO_VILLAGES.includes(village) && (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="h-5 w-5 accent-teal-700" />
            <Bi hi="डेमो डेटा लोड करें (काल्पनिक)" en="Load demo households and visits (synthetic)" />
          </label>
        )}
      </Card>

      <VoiceSetup />

      <Button className="w-full" onClick={start}>
        <Download size={20} /> शुरू करें · Set up this phone
      </Button>
      <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-teal-700" />
        Needs internet once, to download the AI model. Patient notes never leave this phone.
      </p>
    </div>
  );
}
