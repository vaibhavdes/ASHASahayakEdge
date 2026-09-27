import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useSettings } from "../lib/hooks";
import { updateSettings } from "../lib/settings";
import { Bi, Button, Card } from "./ui";

export function SettingsCard() {
  const settings = useSettings();
  const [cloudUrl, setCloudUrl] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (settings) {
      setCloudUrl(settings.cloudUrl);
      setName(settings.name);
    }
  }, [settings?.cloudUrl, settings?.name]);
  if (!settings) return null;

  async function test() {
    if (!settings) return;
    setStatus("…");
    try {
      const r = await fetch(`${cloudUrl.replace(/\/$/, "")}/v1/knowledge/docs`, { signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${settings.deviceToken}` } });
      setStatus(r.ok ? "✓ server reachable" : `server answered ${r.status}`);
    } catch {
      setStatus("✗ not reachable from this phone (check Wi-Fi and the address)");
    }
  }

  return (
    <Card className="space-y-3">
      <Bi hi="सेटिंग्स" en="Settings" className="text-sm font-semibold" />
      <label className="block space-y-1">
        <Bi hi="ज़िला सर्वर" en="District server address" className="text-xs text-slate-500" />
        <input value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm" />
      </label>
      <label className="block space-y-1">
        <Bi hi="नाम" en="Name" className="text-xs text-slate-500" />
        <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="min-h-10 text-sm" onClick={test}>
          जांचें · Test
        </Button>
        <Button
          className="min-h-10 text-sm"
          onClick={async () => {
            await updateSettings({ cloudUrl: cloudUrl.trim(), name: name.trim() || settings.name });
            setStatus("✓ saved");
          }}
        >
          <Save size={16} /> सेव · Save
        </Button>
      </div>
      {status && <p className="text-xs text-slate-600">{status}</p>}
    </Card>
  );
}
