import { tr } from "../lib/i18n";
import { AlertTriangle, BookOpen, ClipboardList, CloudOff, FileText, ListChecks, Plus, ShieldCheck, Users } from "lucide-react";
import { ListenButton } from "../components/ListenButton";
import { StartCard } from "../components/StartCard";
import { TaskList } from "../components/TaskList";
import { Badge, Bi, Button, Card, Empty, Section, Stat, SyndromeBadges, cx } from "../components/ui";
import { allHouseholds } from "../lib/households";
import { useData, useSettings } from "../lib/hooks";
import { dismissNewGuidance, newGuidance } from "../lib/sync";
import { activeAlerts } from "../lib/knowledge";
import { recentVisits, weekSummary } from "../lib/memory";
import { useNav } from "../lib/nav";
import { todaysPlan } from "../lib/plans";
import { localAnomalies } from "../lib/triage";
import { syndromeLabel } from "../lib/tagger";
import { ago, daysSince, shortDate } from "../lib/time";

function SyncFreshness({ lastSync, knowledgeAt }: { lastSync: string | null; knowledgeAt: string | null }) {
  const days = daysSince(lastSync);
  const stale = daysSince(knowledgeAt) > 14;
  const tone = days < 1 ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : days < 7 ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-rose-50 text-rose-900 ring-rose-200";
  return (
    <div className={cx("flex items-start gap-3 rounded-2xl p-3 ring-1", tone)}>
      {days < 1 ? <ShieldCheck className="mt-0.5 shrink-0" size={20} /> : <CloudOff className="mt-0.5 shrink-0" size={20} />}
      <div className="text-sm">
        <div className="font-semibold">{tr("आखिरी सिंक", "Last synced")}: {ago(lastSync)}</div>
        <div className="opacity-80">
          {days === Infinity
            ? tr("सब कुछ इसी फ़ोन पर सेव है। नेटवर्क मिलने पर सिंक होगा।", "Everything is saved on this phone. It syncs when you get network.")
            : stale
              ? tr("जानकारी पुरानी हो सकती है। मौका मिलते ही सिंक करें।", "Guidance may be outdated. Sync when you can.")
              : tr("विज़िट नोट इसी फ़ोन पर रहते हैं।", "Visit notes stay on this phone.")}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const settings = useSettings();
  const nav = useNav();
  const village = settings?.village ?? "RMP";
  const { data: week } = useData(() => weekSummary(village), ["memory"], [village]);
  const { data: alerts } = useData(() => activeAlerts(village), ["alerts"], [village]);
  const { data: recent } = useData(() => recentVisits(5), ["memory"]);
  const { data: today } = useData(() => todaysPlan(village), ["memory", "households"], [village]);
  const { data: rises } = useData(() => localAnomalies(village), ["memory"], [village]);
  const { data: households } = useData(allHouseholds, ["households"]);
  const { data: arrived } = useData(newGuidance, ["guidance"]);
  if (!settings) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{tr("नमस्ते", "Hello")}, {settings.name} 🙏</h1>
        <p className="text-sm text-slate-600">{new Date().toLocaleDateString(settings.lang === "hi" ? "hi-IN" : "en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>

      <SyncFreshness lastSync={settings.lastSync} knowledgeAt={settings.knowledgeSyncedAt} />

      {households && !Object.keys(households).length && <StartCard />}

      {!!arrived?.length && (
        <Card className="space-y-2 border-l-4 border-sky-500">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sky-800">{tr("ज़िले से नई जानकारी", "New from the district")}</span>
            <Button variant="ghost" className="min-h-8 px-2 text-sm" onClick={dismissNewGuidance}>{tr("ठीक है", "Got it")}</Button>
          </div>
          {arrived.map((g) => (
            <button key={g.id} onClick={() => nav.push({ screen: "guidance", q: g.title })} className="flex w-full items-center gap-2 text-left text-sm text-slate-800">
              <BookOpen size={16} className="shrink-0 text-sky-700" /> {g.title}
            </button>
          ))}
          <p className="text-xs text-slate-500">{tr("फ़ोन में सेव है, बिना इंटरनेट भी खुलेगा।", "Saved on this phone; opens without internet too.")}</p>
        </Card>
      )}

      {!!rises?.length && (
        <Section title={<Bi hi="फ़ोन ने देखा: असामान्य बढ़त" en="Unusual rise in my village" />}>
          {rises.map((r) => {
            const label = r.syndromes.map((s) => syndromeLabel(s)).join(" + ");
            return (
              <Card key={r.key} className="border-l-4 border-amber-500">
                <div className="flex items-center gap-2 font-semibold text-amber-800">
                  <AlertTriangle size={18} /> {label}: {r.count} {tr("इस हफ्ते", "this week")}
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  {tr(`आम तौर पर हफ्ते में ${r.usual}। ANM को बताएं।`, `Usually ${r.usual} a week in your village. Tell your ANM.`)}
                </p>
                <Button
                  variant="secondary"
                  className="mt-2 min-h-10 w-full text-sm"
                  onClick={() => nav.push({ screen: "localAlert", syndromes: r.syndromes, title: tr(`मेरे गाँव में ${label} बढ़ रहा है`, `${label} rising in my village`) })}
                >
                  <ListChecks size={16} /> {tr("किसे देखें", "Who to visit")}
                </Button>
              </Card>
            );
          })}
        </Section>
      )}

      {!!alerts?.length && (
        <Section title={<Bi hi="ज़िले से चेतावनी" en="District alerts" />}>
          {alerts.map((a) => (
            <Card key={a.id} className="border-l-4 border-rose-500">
              <div className="flex items-center gap-2 font-semibold text-rose-700">
                <AlertTriangle size={18} /> {a.title}
              </div>
              <p className="mt-1 text-sm text-slate-700">{a.text}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{ago(a.published_at)}</span>
                <ListenButton text={`${a.title}. ${a.text}`} />
              </div>
              <Button variant="secondary" className="mt-2 min-h-10 w-full text-sm" onClick={() => nav.push({ screen: "alert", id: a.id })}>
                <ListChecks size={16} /> {tr("मेरे गाँव में क्या करें", "What to do in my village")}
              </Button>
            </Card>
          ))}
        </Section>
      )}

      <Section
        title={<Bi hi="आज के काम" en="Today's visits" />}
        action={
          <Button variant="ghost" className="min-h-8 text-sm" onClick={() => nav.push({ screen: "today" })}>
            <ClipboardList size={16} /> {tr("सभी", "All")} {today ? `(${today.length})` : ""}
          </Button>
        }
      >
        {today && <TaskList tasks={today} limit={3} />}
      </Section>

      <div className="grid grid-cols-3 gap-2">
        <Button className="px-2" onClick={() => nav.setTab("visit")}>
          <Plus size={20} /> {tr("विज़िट", "Visit")}
        </Button>
        <Button variant="secondary" className="px-2" onClick={() => nav.push({ screen: "guidance" })}>
          <BookOpen size={20} /> {tr("पूछें", "Ask")}
        </Button>
        <Button variant="secondary" className="px-2" onClick={() => nav.push({ screen: "reports" })}>
          <FileText size={20} /> {tr("रिपोर्ट", "Reports")}
        </Button>
      </div>

      <Section title={<Bi hi="इस हफ्ते मेरा गाँव" en="My village this week" />}>
        <Card className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label={tr("विज़िट", "visits")} value={week?.visits ?? "–"} />
            <Stat label={tr("खतरा", "danger")} value={week?.danger ?? "–"} tone={week?.danger ? "rose" : undefined} />
            <Stat label={tr("भेजना बाकी", "to send")} value={week?.pending ?? "–"} tone={week?.pending ? "amber" : undefined} />
          </div>
          {week?.syndromes.length ? (
            <div className="space-y-1.5">
              {week.syndromes.map((f) => (
                <div key={String(f.value)} className="flex items-center gap-2 text-sm">
                  <span className="w-36 truncate">{syndromeLabel(String(f.value))}</span>
                  <div className="h-2 flex-1 rounded-full bg-slate-100">
                    <div className={cx("h-2 rounded-full", String(f.value).startsWith("danger") ? "bg-rose-500" : "bg-amber-500")} style={{ width: `${Math.min(100, (f.count / Math.max(...week.syndromes.map((x) => x.count))) * 100)}%` }} />
                  </div>
                  <span className="w-6 text-right font-semibold">{f.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{tr("इस हफ्ते कोई लक्षण दर्ज नहीं।", "No symptoms recorded this week.")}</p>
          )}
        </Card>
      </Section>

      <Section title={<Bi hi="हाल की विज़िट" en="Recent visits" />} action={<Button variant="ghost" className="min-h-8 text-sm" onClick={() => nav.setTab("households")}><Users size={16} /> {tr("सभी", "All")}</Button>}>
        {recent?.length ? (
          recent.map((v) => (
            <Card key={v.visit_id} onClick={() => nav.push({ screen: "household", id: v.household_id })} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{v.member_name}</span>
                <span className="text-xs text-slate-500">{shortDate(v.visit_at)}</span>
              </div>
              <p className="line-clamp-2 text-sm text-slate-600">{v.text}</p>
              <div className="flex items-center justify-between">
                <SyndromeBadges syndromes={v.syndromes} danger={v.danger} />
                {v.sync_status === "pending" && <Badge tone="amber">{tr("भेजना है", "to send")}</Badge>}
              </div>
            </Card>
          ))
        ) : (
          <Empty>{tr("अभी कोई विज़िट नहीं। + दबाकर पहली विज़िट दर्ज करें।", "No visits yet. Tap + to record the first one.")}</Empty>
        )}
      </Section>
    </div>
  );
}
