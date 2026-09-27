import { AlertTriangle, Cpu, GitMerge, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge, Bi, Button, Card, Empty, Section, Segmented, Spinner, Stat } from "../components/ui";
import { edge } from "../lib/bridge";
import { and, eq } from "../lib/filters";
import { allHouseholds, getConflicts, resolveConflict } from "../lib/households";
import { useData, useSettings } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { listOutbox } from "../lib/outbox";
import { updateSettings } from "../lib/settings";
import { runSync, type SyncReport } from "../lib/sync";
import { ago } from "../lib/time";
import type { NetworkMode } from "../lib/types";

const PRIORITY = [
  { hi: "तुरंत", en: "Urgent danger signs", tone: "rose" as const },
  { hi: "गुमनाम संकेत", en: "Anonymous signals", tone: "teal" as const },
  { hi: "रजिस्टर, रिपोर्ट, सवाल", en: "Registry, reports, questions", tone: "sky" as const },
];

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "yes" : "no") : v == null || v === "" ? "—" : String(v));

export default function SyncScreen() {
  const nav = useNav();
  const settings = useSettings();
  const { data: outbox } = useData(listOutbox, ["outbox"]);
  const { data: conflicts } = useData(getConflicts, ["households"]);
  const { data: households } = useData(allHouseholds, ["households"]);
  const { data: neverCount } = useData(() => edge.count("memory", and(eq("kind", "visit"))), ["memory"]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;

  async function sync() {
    setBusy(true);
    setError(null);
    try {
      setReport(await runSync());
    } catch (e) {
      setError(String(e).includes("offline") ? "ऑफ़लाइन हैं · You are offline. Everything is saved; it will go when network returns." : String(e));
    } finally {
      setBusy(false);
    }
  }

  const setNetwork = async (network: NetworkMode) => {
    await updateSettings({ network });
    if (network !== "offline" && outbox?.length) sync();
  };

  const groups = [0, 1, 2].map((p) => (outbox ?? []).filter((i) => i.priority === p));
  const bytes = (outbox ?? []).reduce((s, i) => s + i.bytes, 0);

  return (
    <div className="space-y-5">
      <Section title={<Bi hi="नेटवर्क" en="Network" />}>
        <Segmented<NetworkMode>
          value={settings.network}
          onChange={setNetwork}
          options={[
            { value: "online", label: "Online" },
            { value: "2g", label: "2G" },
            { value: "offline", label: "Offline" },
          ]}
        />
        <p className="px-1 text-xs text-slate-500">
          {settings.network === "2g"
            ? "2G: only urgent danger signs are sent, without vectors (~250 bytes each)."
            : settings.network === "offline"
              ? "Offline: the app keeps working; everything waits safely in the queue."
              : "Online: queue is sent in priority order, then alerts and guidance are pulled."}
        </p>
      </Section>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-500">आखिरी सिंक · Last sync</div>
            <div className="font-semibold">{ago(settings.lastSync)}</div>
          </div>
          <Button onClick={sync} disabled={busy || settings.network === "offline"}>
            {busy ? <Spinner /> : <RefreshCw size={18} />} सिंक · Sync
          </Button>
        </div>
        {report && (
          <div className="rounded-xl bg-emerald-50 p-2 text-sm text-emerald-900">
            Sent {report.pushed} ({report.bytes} bytes) · {report.alerts} alert(s) · {report.registry} registry update(s)
            {report.knowledge && ` · guidance ${report.knowledge}`}
            {report.conflicts > 0 && ` · ${report.conflicts} conflict(s)`} · {report.ms} ms
          </div>
        )}
        {error && <div className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{error}</div>}
        <div className="text-xs text-slate-500">Server: {settings.cloudUrl}</div>
      </Card>

      <Section title={<Bi hi="भेजने की कतार" en={`Outbox · ${outbox?.length ?? 0} items · ${bytes} bytes`} />}>
        {groups.map((items, p) => (
          <Card key={p} className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge tone={PRIORITY[p].tone}>
                {p + 1}. {PRIORITY[p].hi} · {PRIORITY[p].en}
              </Badge>
              <span className="text-sm font-semibold">{items.length}</span>
            </div>
            {items.slice(0, 4).map((i) => (
              <div key={i.id} className="flex items-center justify-between text-xs text-slate-600">
                <span className="truncate">{i.label}</span>
                <span className="shrink-0 font-mono">
                  {i.bytes} B{i.attempts ? ` · retry ${i.attempts}` : ""}
                </span>
              </div>
            ))}
            {items.length > 4 && <div className="text-xs text-slate-400">+{items.length - 4} more</div>}
          </Card>
        ))}
        <Card className="flex items-center gap-3">
          <Lock className="text-slate-600" size={20} />
          <div className="text-sm">
            <div className="font-semibold">{neverCount ?? "–"} visit notes never leave this phone</div>
            <div className="text-xs text-slate-500">Names, phone numbers and notes stay here. Only anonymous signals go to the district.</div>
          </div>
        </Card>
      </Section>

      <Section title={<Bi hi="टकराव" en="Conflicts (same field edited on two devices)" />}>
        {!conflicts?.length && <Empty>No conflicts. Different fields edited on different phones merge automatically.</Empty>}
        {conflicts?.map((c) => (
          <Card key={`${c.household_id}:${c.field}`} className="space-y-2 border-l-4 border-amber-500">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <GitMerge size={18} /> {households?.[c.household_id]?.house_no ?? "Household"} · {c.field}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="मेरा · mine (this phone)" value={show(c.mine)} />
              <Stat label={`उनका · theirs (${c.theirs_dev.slice(0, 8)})`} value={show(c.theirs)} tone="amber" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => resolveConflict(c, "mine", settings.deviceId)}>
                मेरा रखें · Keep mine
              </Button>
              <Button variant="secondary" onClick={() => resolveConflict(c, "theirs", settings.deviceId)}>
                उनका लें · Take theirs
              </Button>
            </div>
          </Card>
        ))}
      </Section>

      <Button variant="secondary" className="w-full" onClick={() => nav.push({ screen: "inspector" })}>
        <Cpu size={18} /> Device memory inspector
      </Button>
      {settings.network === "offline" && (outbox?.[0]?.priority === 0) && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" /> Urgent danger sign waiting. It will be sent first as soon as any network (even 2G) is available.
        </div>
      )}
    </div>
  );
}
