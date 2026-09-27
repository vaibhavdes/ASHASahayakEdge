import { AlertTriangle, ArrowLeft, Lock } from "lucide-react";
import { TaskList } from "../components/TaskList";
import { Bi, Card, Spinner } from "../components/ui";
import { edge } from "../lib/bridge";
import { useData, useSettings } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { planForAlert, todaysPlan } from "../lib/plans";
import type { KnowledgeDoc } from "../lib/types";
import { ago } from "../lib/time";

export function AlertPlan({ id }: { id: string }) {
  const nav = useNav();
  const settings = useSettings();
  const village = settings?.village ?? "";
  const { data: alert } = useData(async () => (await edge.retrieve<KnowledgeDoc>("knowledge", [id]))[0] ?? null, ["alerts"], [id]);
  const { data: tasks } = useData(
    async () => (alert && village ? planForAlert({ id: alert.id, ...alert.payload }, village) : []),
    ["memory", "households"],
    [alert?.id, village],
  );
  return (
    <div className="space-y-4">
      <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
        <ArrowLeft size={18} /> वापस · Back
      </button>
      {alert && (
        <Card className="border-l-4 border-rose-500">
          <div className="flex items-center gap-2 font-semibold text-rose-700">
            <AlertTriangle size={18} /> {alert.payload.title}
          </div>
          <p className="mt-1 text-sm text-slate-700">{alert.payload.text}</p>
          <div className="mt-1 text-xs text-slate-500">{ago(alert.payload.published_at)}</div>
        </Card>
      )}
      <div>
        <h1 className="text-lg font-bold">
          <Bi hi="आपके गाँव में क्या करें" en="What this means in your village" />
        </h1>
        <p className="flex items-start gap-1 text-xs text-slate-500">
          <Lock size={12} className="mt-0.5 shrink-0" />
          Worked out on this phone from your own records. The district sees the pattern, not these names.
        </p>
      </div>
      {tasks ? <TaskList tasks={tasks} /> : <Spinner className="text-teal-700" />}
    </div>
  );
}

export function LocalAlertPlan({ syndromes, title }: { syndromes: string[]; title: string }) {
  const nav = useNav();
  const settings = useSettings();
  const village = settings?.village ?? "";
  const { data: tasks } = useData(
    async () => (village ? planForAlert({ id: `local:${syndromes.join("+")}`, kind: "alert", title, text: title, source: "This phone", topic: syndromes.join(","), published_at: new Date().toISOString() }, village) : []),
    ["memory", "households"],
    [village, syndromes.join()],
  );
  return (
    <div className="space-y-4">
      <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
        <ArrowLeft size={18} /> वापस · Back
      </button>
      <Card className="border-l-4 border-amber-500">
        <div className="flex items-center gap-2 font-semibold text-amber-800">
          <AlertTriangle size={18} /> {title}
        </div>
        <p className="mt-1 text-sm text-slate-700">Spotted on this phone from your own visits, without any network. Tell your ANM; the district will also see it at the next sync.</p>
      </Card>
      {tasks ? <TaskList tasks={tasks} /> : <Spinner className="text-teal-700" />}
    </div>
  );
}

export function Today() {
  const nav = useNav();
  const settings = useSettings();
  const { data: tasks } = useData(async () => (settings ? todaysPlan(settings.village) : []), ["memory", "households"], [settings?.village]);
  return (
    <div className="space-y-4">
      <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
        <ArrowLeft size={18} /> वापस · Back
      </button>
      <h1 className="text-lg font-bold">
        <Bi hi="आज के काम" en="Today's visits, most urgent first" />
      </h1>
      <p className="text-xs text-slate-500">From danger signs, recent fever, pregnancies and immunisations in your records. Works offline.</p>
      {tasks ? <TaskList tasks={tasks} /> : <Spinner className="text-teal-700" />}
    </div>
  );
}
