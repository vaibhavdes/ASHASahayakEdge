import { CheckCircle2, Download } from "lucide-react";
import { useState } from "react";
import { Bi, Button, Card, Progress, Segmented, Spinner } from "../components/ui";
import { VoiceSetup } from "../components/VoiceSetup";
import { logActivity } from "../lib/activity";
import { loadModel } from "../lib/embedder";
import { loadStarterKnowledge } from "../lib/starter";
import { updateSettings } from "../lib/settings";
import type { Role } from "../lib/types";
import { VILLAGES } from "../lib/villages";

export default function Setup() {
  const [role, setRole] = useState<Role>("ASHA");
  const [name, setName] = useState("");
  const [village, setVillage] = useState("MDH");
  const [cloudUrl, setCloudUrl] = useState(import.meta.env.VITE_CLOUD_URL || "https://sahayak-cloud-362605925833.asia-south1.run.app");
  const [enrollCode, setEnrollCode] = useState("");
  const [phase, setPhase] = useState<"form" | "working" | "error">("form");
  const [label, setLabel] = useState("");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");

  async function start() {
    setPhase("working");
    try {
      const deviceId = crypto.randomUUID();
      setLabel("Registering this phone");
      const response = await fetch(`${cloudUrl.replace(/\/$/, "")}/v1/enroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, role, village, code: enrollCode.trim() }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Enrollment code is incorrect." : `Enrollment failed: ${response.status}`);
      const { token } = await response.json() as { token: string };
      await updateSettings({ deviceId, deviceToken: token, role, name: name.trim() || role, village, cloudUrl, modelSource: "huggingface" });
      setLabel("ऑफ़लाइन AI डाउनलोड · Downloading offline AI (one time, ~135 MB)");
      await loadModel((p) => setPct(Math.round(p * 0.6)));

      setLabel("स्वास्थ्य जानकारी · Loading health guidance");
      setPct(62);
      await loadStarterKnowledge();

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
          <Bi hi="क्षेत्र" en="Assigned area" className="text-sm font-semibold" />
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
          <Bi hi="फ़ोन जोड़ने का कोड" en="Enrollment code (one time per phone)" className="text-sm font-semibold" />
          <input value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} autoCapitalize="off" autoCorrect="off" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-base" />
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Advanced: district server</summary>
          <input value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm" />
        </details>
      </Card>

      <VoiceSetup />

      <Button className="w-full" disabled={!enrollCode.trim()} onClick={start}>
        <Download size={20} /> शुरू करें · Set up this phone
      </Button>
      <p className="flex items-start gap-2 px-1 text-xs text-slate-500">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-teal-700" />
        Needs internet once for enrollment and AI download. Visit notes stay on this phone; family details sync only with enrolled phones in your area. Use fictional people for evaluation.
      </p>
    </div>
  );
}
