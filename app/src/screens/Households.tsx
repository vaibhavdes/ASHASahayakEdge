import { tr } from "../lib/i18n";
import { ChevronRight, Plus, Search } from "lucide-react";
import { StartCard } from "../components/StartCard";
import { useState } from "react";
import { Badge, Button, Card, Empty } from "../components/ui";
import { allHouseholds } from "../lib/households";
import { useData } from "../lib/hooks";
import { useNav } from "../lib/nav";
import type { Versioned } from "../lib/types";

export default function Households() {
  const nav = useNav();
  const [q, setQ] = useState("");
  const { data } = useData(allHouseholds, ["households"]);
  const list = Object.values(data ?? {})
    .filter((h) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [h.house_no, h.fields.head.value, ...h.fields.members.value.map((m) => m.name)].some((s) => s.toLowerCase().includes(needle));
    })
    .sort((a, b) => a.house_no.localeCompare(b.house_no));

  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={() => nav.push({ screen: "addFamily" })}><Plus size={18} /> {tr("नया परिवार", "Add family")}</Button>
      <div className="relative">
        <Search className="absolute top-3.5 left-3 text-slate-400" size={20} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("नाम या घर नंबर", "name or house no.")}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pr-3 pl-10 text-base"
        />
      </div>
      <div className="px-1 text-xs text-slate-500">{list.length} {tr("परिवार", "families")}</div>
      {data && !Object.keys(data).length && <StartCard />}
      {data && !!Object.keys(data).length && !list.length && <Empty>{tr("कोई परिवार नहीं मिला।", "No family found.")}</Empty>}
      {list.map((h) => {
        const dirty = Object.values(h.fields).some((f) => (f as Versioned).dirty);
        const pregnant = h.fields.pregnant_member.value;
        return (
          <Card key={h.id} onClick={() => nav.push({ screen: "household", id: h.id })} className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-xs font-bold text-teal-800">{h.fields.head.value.trim().charAt(0).toUpperCase() || "#"}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{h.fields.head.value}</div>
              <div className="text-xs text-slate-500">
                {h.house_no} · {h.ward} · {h.fields.members.value.length} {tr("सदस्य", "members")}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {pregnant && <Badge tone="violet">{tr("गर्भवती", "Pregnant")}</Badge>}
                {h.fields.high_risk.value && <Badge tone="rose">{tr("हाई रिस्क", "High risk")}</Badge>}
                {dirty && <Badge tone="amber">{tr("भेजना है", "to send")}</Badge>}
              </div>
            </div>
            <ChevronRight className="text-slate-400" size={20} />
          </Card>
        );
      })}
    </div>
  );
}
