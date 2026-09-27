import { CheckCircle2, Circle, MapPin, Sparkles } from "lucide-react";
import { useData } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { doneTasks, markDone, type Task } from "../lib/plans";
import { Badge, Card, Empty, cx } from "./ui";

const TONE = { 1: "rose", 2: "amber", 3: "slate" } as const;
const LABEL = { 1: "आज · today", 2: "जल्द · soon", 3: "देख लें · check" } as const;

export function TaskList({ tasks, limit }: { tasks: Task[]; limit?: number }) {
  const nav = useNav();
  const { data: done } = useData(doneTasks, ["households"]);
  if (!tasks.length) return <Empty>कुछ बाकी नहीं · nothing pending</Empty>;
  const shown = limit ? tasks.slice(0, limit) : tasks;
  return (
    <div className="space-y-2">
      {shown.map((t) => {
        const isDone = done?.has(t.id);
        return (
          <Card key={t.id} className={cx("flex items-start gap-3 py-3", isDone && "opacity-50")}>
            <button onClick={() => markDone(t.id, !isDone)} aria-label="done" className="mt-0.5 text-teal-700">
              {isDone ? <CheckCircle2 size={24} /> : <Circle size={24} />}
            </button>
            <button className="min-w-0 flex-1 text-left" onClick={() => nav.push({ screen: "household", id: t.household_id })}>
              <div className="flex items-center justify-between gap-2">
                <span className={cx("truncate font-semibold", isDone && "line-through")}>{t.member_name ?? t.house_no}</span>
                <Badge tone={TONE[t.priority]}>{LABEL[t.priority]}</Badge>
              </div>
              <div className="text-sm text-slate-700">{t.why_hi}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{t.why_en}</span>
                <span>· {t.house_no}</span>
                {t.distance_m != null && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin size={12} /> {t.distance_m < 20 ? "same house as a case" : `${t.distance_m} m from a case`}
                  </span>
                )}
                {t.source === "ai-match" && (
                  <span className="inline-flex items-center gap-0.5 text-violet-700">
                    <Sparkles size={12} /> AI
                  </span>
                )}
              </div>
            </button>
          </Card>
        );
      })}
    </div>
  );
}
