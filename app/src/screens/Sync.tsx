import { tr } from "../lib/i18n";
import { AlertTriangle, GitMerge, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Badge, Bi, Button, Card, Empty, Section, Segmented, Spinner, Stat } from "../components/ui";
import { edge } from "../lib/bridge";
import { and, eq } from "../lib/filters";
import { allHouseholds, getConflicts, resolveConflict } from "../lib/households";
import { useData, useSettings } from "../lib/hooks";
import { listOutbox } from "../lib/outbox";
import { updateSettings } from "../lib/settings";
import { runSync, slowConnection, type SyncReport } from "../lib/sync";
import { ago } from "../lib/time";
import { syndromeLabel } from "../lib/tagger";
import type { NetworkMode, OutboxItem } from "../lib/types";

const PRIORITY = [
  { hi: "तुरंत", en: "Urgent danger signs", tone: "rose" as const },
  { hi: "लक्षण संकेत", en: "Symptom signals", tone: "teal" as const },
  { hi: "रजिस्टर, रिपोर्ट, सवाल", en: "Registry, reports, questions", tone: "sky" as const },
];

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "yes" : "no") : v == null || v === "" ? "—" : String(v));

// What each queued item is, in the worker's words.
function itemLabel(i: OutboxItem) {
  const p = i.payload;
  const symptoms = (list: unknown) => ((list as string[] | undefined) ?? []).map((s) => syndromeLabel(s)).join(" + ");
  if (i.kind === "signal") return tr(`${symptoms(p.syndromes)} (बिना नाम)`, `${symptoms(p.syndromes)} (no name)`);
  if (i.kind === "household") return tr(`${p.house_no}: परिवार की जानकारी`, `${p.house_no}: family details`);
  if (i.kind === "retract") return tr("पुरानी लक्षण रिपोर्ट वापस", "Withdraw an old symptom report");
  if (i.kind === "report") return p.kind === "s_form" ? tr("साप्ताहिक S-फ़ॉर्म", "Weekly S-form") : tr("मासिक सारांश", "Monthly summary");
  return tr(`डॉक्टर से सवाल: ${String(p.question).slice(0, 40)}`, `Question: ${String(p.question).slice(0, 40)}`);
}

export default function SyncScreen() {
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
      setError(String(e).includes("offline") ? tr("अभी नेटवर्क नहीं है। सब कुछ फ़ोन पर सेव है, नेटवर्क आने पर भेज दिया जाएगा।", "You are offline. Everything is saved; it will go when network returns.") : String(e));
    } finally {
      setBusy(false);
    }
  }

  const setNetwork = async (network: NetworkMode) => {
    await updateSettings({ network });
    if (network !== "offline" && outbox?.length) sync();
  };

  const groups = [0, 1, 2].map((p) => (outbox ?? []).filter((i) => i.priority === p));

  return (
    <div className="space-y-5">
      <Section title={<Bi hi="नेटवर्क" en="Network" />}>
        <Segmented<NetworkMode>
          value={settings.network}
          onChange={setNetwork}
          options={[
            { value: "online", label: tr("अपने आप", "Auto") },
            { value: "offline", label: tr("ऑफ़लाइन काम", "Work offline") },
          ]}
        />
        <p className="px-1 text-xs text-slate-500">
          {settings.network === "offline" ? tr("नेटवर्क आने तक सब कुछ फ़ोन पर सेव रहेगा।", "Everything is saved on this phone until you reconnect.") : slowConnection()
            ? tr("धीमा नेटवर्क: पहले ज़रूरी संदेश जाएंगे, बाकी अच्छे नेटवर्क पर।", "Slow network: urgent items go first, the rest wait for a better connection.")
            : tr("नेटवर्क मिलते ही अपने आप सिंक होता है।", "Syncs by itself whenever there is network.")}
        </p>
      </Section>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-500">{tr("आखिरी सिंक", "Last sync")}</div>
            <div className="font-semibold">{ago(settings.lastSync)}</div>
          </div>
          <Button onClick={sync} disabled={busy || settings.network === "offline"}>
            {busy ? <Spinner /> : <RefreshCw size={18} />} {tr("सिंक", "Sync")}
          </Button>
        </div>
        {report && (
          <div className="rounded-xl bg-emerald-50 p-2 text-sm text-emerald-900">
            ✓ {tr(`${report.pushed} भेजे · ${report.alerts} चेतावनी · ${report.registry} परिवार अपडेट`, `Sent ${report.pushed} · ${report.alerts} alert(s) · ${report.registry} family update(s)`)}
            {report.knowledge && tr(" · नई जानकारी मिली", " · new guidance received")}
            {report.conflicts > 0 && tr(` · ${report.conflicts} टकराव`, ` · ${report.conflicts} conflict(s)`)}
          </div>
        )}
        {error && <div className="rounded-xl bg-amber-50 p-2 text-sm text-amber-900">{error}</div>}
      </Card>

      <Section title={<Bi hi={`भेजना बाकी · ${outbox?.length ?? 0}`} en={`Waiting to send · ${outbox?.length ?? 0}`} />}>
        {groups.map((items, p) => (
          <Card key={p} className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge tone={PRIORITY[p].tone}>
                {p + 1}. {tr(PRIORITY[p].hi, PRIORITY[p].en)}
              </Badge>
              <span className="text-sm font-semibold">{items.length}</span>
            </div>
            {items.slice(0, 4).map((i) => (
              <div key={i.id} className="flex items-center justify-between text-xs text-slate-600">
                <span className="truncate">{itemLabel(i)}</span>
              </div>
            ))}
            {items.length > 4 && <div className="text-xs text-slate-400">+{items.length - 4} {tr("और", "more")}</div>}
          </Card>
        ))}
        <Card className="flex items-center gap-3">
          <Lock className="text-slate-600" size={20} />
          <div className="text-sm">
            <div className="font-semibold">{tr(`${neverCount ?? "–"} विज़िट नोट कभी फ़ोन से बाहर नहीं जाते`, `${neverCount ?? "–"} visit notes never leave this phone`)}</div>
            <div className="text-xs text-slate-500">{tr("परिवार की जानकारी सिर्फ़ आपके क्षेत्र के फ़ोन से सिंक होती है।", "Family details sync only with phones in your area.")}</div>
          </div>
        </Card>
      </Section>

      <Section title={<Bi hi="टकराव" en="Conflicts" />}>
        {!conflicts?.length && <Empty>{tr("कोई टकराव नहीं। दो फ़ोन पर अलग-अलग बदलाव अपने आप जुड़ जाते हैं।", "No conflicts. Changes from different phones merge automatically.")}</Empty>}
        {conflicts?.map((c) => (
          <Card key={`${c.household_id}:${c.field}`} className="space-y-2 border-l-4 border-amber-500">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <GitMerge size={18} /> {households?.[c.household_id]?.house_no ?? "Household"} · {c.field}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label={tr("इस फ़ोन का", "this phone")} value={show(c.mine)} />
              <Stat label={tr("दूसरे फ़ोन का", "other phone")} value={show(c.theirs)} tone="amber" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => resolveConflict(c, "mine", settings.deviceId)}>
                {tr("मेरा रखें", "Keep mine")}
              </Button>
              <Button variant="secondary" onClick={() => resolveConflict(c, "theirs", settings.deviceId)}>
                {tr("उनका लें", "Take theirs")}
              </Button>
            </div>
          </Card>
        ))}
      </Section>

      {settings.network === "offline" && (outbox?.[0]?.priority === 0) && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" /> {tr("खतरे का संकेत भेजना बाकी है। नेटवर्क (2G भी) मिलते ही सबसे पहले जाएगा।", "Urgent danger sign waiting. It goes first as soon as any network (even 2G) is available.")}
        </div>
      )}
    </div>
  );
}
