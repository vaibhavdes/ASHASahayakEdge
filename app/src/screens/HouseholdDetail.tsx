import { ArrowLeft, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Bi, Button, Card, Empty, Section, SyncBadge, SyndromeBadges } from "../components/ui";
import { editField, getHousehold } from "../lib/households";
import { useData, useSettings } from "../lib/hooks";
import { deleteVisit, similarVisits, updateVisitNote, visitsForHousehold } from "../lib/memory";
import { VoiceButton } from "../components/VoiceButton";
import { useNav } from "../lib/nav";
import { shortDate } from "../lib/time";
import type { Hit, Household, HouseholdField, Versioned, Visit } from "../lib/types";

function EditVisit({ visit, household, onDone }: { visit: Visit; household: Household; onDone: () => void }) {
  const [text, setText] = useState(visit.text);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-2">
      <VoiceButton compact onText={(spoken) => setText((t) => `${t} ${spoken}`)} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="min-h-10 text-sm" onClick={onDone}>
          रद्द · Cancel
        </Button>
        <Button
          className="min-h-10 text-sm"
          disabled={saving || !text.trim()}
          onClick={async () => {
            setSaving(true);
            await updateVisitNote(visit, text.trim(), household);
            setSaving(false);
            onDone();
          }}
        >
          सेव · Save
        </Button>
      </div>
      <p className="text-xs text-slate-500">If the symptoms change, the old anonymous signal is withdrawn and a corrected one is sent.</p>
    </div>
  );
}

function VersionTag({ f }: { f: Versioned }) {
  return f.dirty ? <Badge tone="amber">भेजना है · pending (base v{f.base ?? f.ts})</Badge> : <span className="text-[11px] text-slate-400">v{f.ts} · {f.dev.slice(0, 8)}</span>;
}

function EditableField({ label, f, onSave, type = "text" }: { label: { hi: string; en: string }; f: Versioned<string | null>; onSave: (v: string) => void; type?: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.value ?? "");
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <Bi hi={label.hi} en={label.en} className="text-xs text-slate-500" />
        {editing ? (
          <input autoFocus type={type} value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2" />
        ) : (
          <div className="font-medium">{f.value || "—"}</div>
        )}
        <VersionTag f={f} />
      </div>
      {editing ? (
        <Button
          className="min-h-10"
          onClick={() => {
            onSave(value);
            setEditing(false);
          }}
        >
          Save
        </Button>
      ) : (
        <button onClick={() => setEditing(true)} className="rounded-lg p-2 text-teal-700 active:bg-teal-50" aria-label="edit">
          <Pencil size={18} />
        </button>
      )}
    </div>
  );
}

export default function HouseholdDetail({ id }: { id: string }) {
  const nav = useNav();
  const settings = useSettings();
  const { data: h } = useData(() => getHousehold(id), ["households"], [id]);
  const { data: visits } = useData(() => visitsForHousehold(id), ["memory"], [id]);
  const [similar, setSimilar] = useState<{ for: string; hits: Hit<Visit>[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (!h || !settings) return null;

  const save = <K extends HouseholdField>(field: K, value: never) => editField(id, field, value, settings.deviceId);
  const pregnantName = h.fields.members.value.find((m) => m.id === h.fields.pregnant_member.value)?.name;

  return (
    <div className="space-y-4">
      <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
        <ArrowLeft size={18} /> वापस · Back
      </button>
      <div>
        <h1 className="text-xl font-bold">{h.fields.head.value}</h1>
        <p className="text-sm text-slate-600">
          {h.house_no} · Ward {h.ward}
        </p>
      </div>

      <Section title={<Bi hi="परिवार का रिकॉर्ड" en="Household record" />}>
        <Card className="divide-y divide-slate-100 py-1">
          <EditableField label={{ hi: "मुखिया", en: "Head of household" }} f={h.fields.head} onSave={(v) => save("head", v as never)} />
          <EditableField label={{ hi: "फ़ोन", en: "Phone" }} f={h.fields.phone} onSave={(v) => save("phone", v as never)} />
          <EditableField label={{ hi: "प्रसव की तारीख", en: "Expected delivery date" }} type="date" f={h.fields.edd} onSave={(v) => save("edd", v as never)} />
          <div className="flex items-center gap-2 py-2">
            <div className="flex-1">
              <Bi hi="हाई रिस्क" en="High risk" className="text-xs text-slate-500" />
              <div>
                <VersionTag f={h.fields.high_risk} />
              </div>
            </div>
            <input type="checkbox" checked={h.fields.high_risk.value} onChange={(e) => save("high_risk", e.target.checked as never)} className="h-6 w-6 accent-rose-600" />
          </div>
          {pregnantName && (
            <div className="py-2 text-sm">
              <Badge tone="violet">गर्भवती · pregnant</Badge> <span className="font-medium">{pregnantName}</span>
            </div>
          )}
        </Card>
      </Section>

      <Section title={<Bi hi="सदस्य" en="Members" />}>
        <Card className="divide-y divide-slate-100 py-1">
          {h.fields.members.value.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-2">
              <div className="flex-1">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-slate-500">
                  {m.sex === "F" ? "महिला" : "पुरुष"} · {m.age} yrs
                </div>
              </div>
              <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => nav.push({ screen: "visit", householdId: h.id, memberId: m.id })}>
                <Plus size={16} /> विज़िट
              </Button>
            </div>
          ))}
        </Card>
      </Section>

      <Section title={<Bi hi="विज़िट इतिहास" en="Visit history" />}>
        {!visits?.length && <Empty>No visits yet.</Empty>}
        {visits?.map((v) => (
          <Card key={v.visit_id} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{v.member_name}</span>
              <span className="text-xs text-slate-500">{shortDate(v.visit_at)}</span>
            </div>
            {editing === v.visit_id ? (
              <EditVisit visit={v} household={h} onDone={() => setEditing(null)} />
            ) : (
              <p className="text-sm text-slate-700">
                {v.text} {v.edited_at && <span className="text-xs text-slate-400">(corrected)</span>}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SyndromeBadges syndromes={v.syndromes} danger={v.danger} />
              <SyncBadge cls={v.sync_class} status={v.sync_status} />
            </div>
            {editing !== v.visit_id && (
              <div className="flex gap-3 text-xs font-semibold">
                <button className="flex items-center gap-1 text-teal-700" onClick={() => setEditing(v.visit_id)}>
                  <Pencil size={13} /> सुधारें · Edit
                </button>
                <button
                  className="flex items-center gap-1 text-rose-700"
                  onClick={() => confirm("यह विज़िट हटाएं? · Delete this visit?") && deleteVisit(v)}
                >
                  <Trash2 size={13} /> हटाएं · Delete
                </button>
              </div>
            )}
            {!!v.syndromes.length && (
              <button
                onClick={async () => setSimilar({ for: v.visit_id, hits: await similarVisits(v.visit_id) })}
                className="flex items-center gap-1 text-xs font-semibold text-teal-700"
              >
                <Sparkles size={14} /> मिलते-जुलते केस · Similar past cases
              </button>
            )}
            {similar?.for === v.visit_id && (
              <div className="space-y-1 rounded-xl bg-teal-50 p-2">
                {similar.hits.map((s) => (
                  <div key={s.id} className="text-xs">
                    <span className="font-semibold">{s.payload.member_name}</span> ({s.payload.house_no}, {shortDate(s.payload.visit_at)}): {s.payload.text}{" "}
                    <span className="text-slate-500">[{s.score.toFixed(2)}]</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </Section>
    </div>
  );
}
