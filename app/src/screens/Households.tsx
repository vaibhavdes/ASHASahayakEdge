import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Badge, Card, Empty } from "../components/ui";
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
      <div className="relative">
        <Search className="absolute top-3.5 left-3 text-slate-400" size={20} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="नाम या घर नंबर · name or house no."
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pr-3 pl-10 text-base"
        />
      </div>
      <div className="px-1 text-xs text-slate-500">{list.length} परिवार · families</div>
      {list.length === 0 && <Empty>No households. Load demo data in setup or add from the registry.</Empty>}
      {list.map((h) => {
        const dirty = Object.values(h.fields).some((f) => (f as Versioned).dirty);
        const pregnant = h.fields.pregnant_member.value;
        return (
          <Card key={h.id} onClick={() => nav.push({ screen: "household", id: h.id })} className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-xs font-bold text-teal-800">{h.house_no.split("-")[1]}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{h.fields.head.value}</div>
              <div className="text-xs text-slate-500">
                {h.house_no} · Ward {h.ward} · {h.fields.members.value.length} members
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {pregnant && <Badge tone="violet">गर्भवती · ANC</Badge>}
                {h.fields.high_risk.value && <Badge tone="rose">High risk</Badge>}
                {dirty && <Badge tone="amber">रजिस्टर में भेजना है</Badge>}
              </div>
            </div>
            <ChevronRight className="text-slate-400" size={20} />
          </Card>
        );
      })}
    </div>
  );
}
