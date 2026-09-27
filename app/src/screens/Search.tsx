import { BadgeCheck, BookOpen, MessageCircleQuestion, Search as SearchIcon, Sparkles, Timer, X } from "lucide-react";
import { useState } from "react";
import { Badge, Bi, Button, Card, Empty, Segmented, Spinner, SyndromeBadges } from "../components/ui";
import { ListenButton } from "../components/ListenButton";
import { VoiceButton } from "../components/VoiceButton";
import { useData, useSettings } from "../lib/hooks";
import { ask, askDoctor, isExpired, myQuestions, scrubQuestion, type AskResult } from "../lib/knowledge";
import { searchVisits, similarVisits, type SearchResult } from "../lib/memory";
import { useNav } from "../lib/nav";
import { daysSince, shortDate } from "../lib/time";
import type { Hit, SearchMode, Visit } from "../lib/types";

const PATIENT_EXAMPLES = ["bacche ko dast", "garbhvati mahila BP", "बुखार और दाने पिछले हफ्ते", "khansi 3 hafte", "newborn not feeding"];
const GUIDANCE_EXAMPLES = ["navjat doodh nahi pee raha", "ORS kitna dena hai", "गर्भवती को सिर दर्द", "bukhar aur daane"];

const MODES: { value: SearchMode; label: string }[] = [
  { value: "hybrid", label: "स्मार्ट" },
  { value: "dense", label: "अर्थ" },
  { value: "sparse", label: "शब्द" },
  { value: "diverse", label: "विविध" },
];
const MODE_HELP: Record<SearchMode, string> = {
  hybrid: "Smart: meaning and exact words, recent visits first",
  dense: "By meaning, even if the words differ",
  sparse: "Exact words only",
  diverse: "Varied results, no near-duplicates",
};

function PatientSearch() {
  const nav = useNav();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [similar, setSimilar] = useState<{ for: string; hits: Hit<Visit>[] } | null>(null);

  async function run(query = q, m = mode, drop = dropped) {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setRes(await searchVisits(query, m, drop));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setDropped([]);
          run(q, mode, []);
        }}
        className="flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="मरीज़ खोजें · search visits" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base" />
        <VoiceButton compact onText={(spoken) => { setQ(spoken); setDropped([]); run(spoken, mode, []); }} />
        <Button type="submit" className="px-3" aria-label="search">
          {busy ? <Spinner /> : <SearchIcon size={20} />}
        </Button>
      </form>
      <Segmented value={mode} options={MODES} onChange={(m) => { setMode(m); run(q, m); }} />
      <p className="px-1 text-xs text-slate-500">{MODE_HELP[mode]}</p>

      {!res && (
        <div className="flex flex-wrap gap-1.5">
          {PATIENT_EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setQ(ex); run(ex); }} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300">
              {ex}
            </button>
          ))}
        </div>
      )}

      {res && (
        <>
          {!!res.chips.length && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">Filters:</span>
              {res.chips.map((c) => {
                const off = dropped.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      const next = off ? dropped.filter((d) => d !== c.id) : [...dropped, c.id];
                      setDropped(next);
                      run(q, mode, next);
                    }}
                    className={`flex items-center gap-1 rounded-full px-2 py-1 ring-1 ${off ? "bg-white text-slate-400 line-through ring-slate-200" : "bg-teal-50 text-teal-800 ring-teal-200"}`}
                  >
                    {c.label} {!off && <X size={12} />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-1 px-1 text-xs text-slate-500">
            <Timer size={14} /> {res.hits.length} results · {res.embedMs + res.searchMs} ms · offline
          </div>
          {!res.hits.length && <Empty>Nothing found. Try other words or remove a filter.</Empty>}
          {res.hits.map((h) => (
            <Card key={h.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => nav.push({ screen: "household", id: h.payload.household_id })} className="truncate text-left font-semibold text-teal-900">
                  {h.payload.member_name} <span className="text-xs font-normal text-slate-500">{h.payload.house_no}</span>
                </button>
                <span className="shrink-0 text-xs text-slate-500">{shortDate(h.payload.visit_at)}</span>
              </div>
              <p className="text-sm text-slate-700">{h.payload.text}</p>
              <div className="flex items-center justify-between">
                <SyndromeBadges syndromes={h.payload.syndromes} danger={h.payload.danger} />
                <span className="font-mono text-[11px] text-slate-400">{h.score.toFixed(3)}</span>
              </div>
              <button onClick={async () => setSimilar({ for: h.id, hits: await similarVisits(h.id) })} className="flex items-center gap-1 text-xs font-semibold text-teal-700">
                <Sparkles size={14} /> मिलते-जुलते केस · Similar cases
              </button>
              {similar?.for === h.id && (
                <div className="space-y-1 rounded-xl bg-teal-50 p-2">
                  {similar.hits.map((s) => (
                    <div key={s.id} className="text-xs">
                      <span className="font-semibold">{s.payload.member_name}</span> ({shortDate(s.payload.visit_at)}): {s.payload.text}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function AskDoctor({ question, village }: { question: string; village: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (sent) return <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">भेजा जाएगा · queued for a doctor; the answer comes back with a sync.</div>;
  if (preview !== null) {
    return (
      <Card className="space-y-2 border-l-4 border-sky-500">
        <div className="text-sm font-semibold">यह भेजा जाएगा · This is what will be sent</div>
        <textarea value={preview} onChange={(e) => setPreview(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" aria-label="Edit the question before sharing" />
        <p className="text-xs text-slate-500">Check and remove names, phone numbers, addresses and other identifying details before sending. Automatic replacement can miss them, especially in Hindi.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setPreview(null)}>रद्द · Cancel</Button>
          <Button disabled={!preview.trim()} onClick={async () => { await askDoctor(preview, village); setSent(true); }}>भेजें · Send</Button>
        </div>
      </Card>
    );
  }
  return (
    <Button variant="secondary" className="w-full" onClick={async () => setPreview(await scrubQuestion(question))}>
      <MessageCircleQuestion size={18} /> डॉक्टर से पूछें · Ask a doctor
    </Button>
  );
}

function MyQuestions() {
  const { data } = useData(myQuestions, ["alerts", "sync"]);
  if (!data?.length) return null;
  return (
    <div className="space-y-2">
      <div className="px-1 text-sm font-semibold text-slate-600">
        <Bi hi="मेरे सवाल" en="My questions to doctors" />
      </div>
      {data.slice(0, 5).map((q) => (
        <Card key={q.id} className="space-y-1 py-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{q.question}</span>
            <Badge tone={q.status === "answered" ? "emerald" : q.status === "sent" ? "sky" : "amber"}>
              {q.status === "answered" ? "उत्तर मिला" : q.status === "sent" ? "भेजा" : "कतार में"}
            </Badge>
          </div>
          {q.answer_text && <p className="rounded-lg bg-emerald-50 p-2 text-slate-800">{q.answer_text}</p>}
        </Card>
      ))}
    </div>
  );
}

function Guidance() {
  const settings = useSettings();
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AskResult | null>(null);
  const stale = daysSince(settings?.knowledgeSyncedAt) > 14;

  async function run(query = q) {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setRes(await ask(query));
      setAsked(query);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="सवाल पूछें · ask a question" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base" />
        <VoiceButton compact onText={(spoken) => { setQ(spoken); run(spoken); }} />
        <Button type="submit" className="px-3" aria-label="ask">
          {busy ? <Spinner /> : <BookOpen size={20} />}
        </Button>
      </form>
      <div className="px-1 text-xs text-slate-500">
        Guidance v{settings?.knowledgeVersion ?? "?"} · works offline{stale && <span className="font-semibold text-amber-700"> · may be outdated, sync when possible</span>}
      </div>
      {!res && (
        <div className="flex flex-wrap gap-1.5">
          {GUIDANCE_EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setQ(ex); run(ex); }} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300">
              {ex}
            </button>
          ))}
        </div>
      )}
      {res && (
        <>
          <div className="px-1 text-xs text-slate-500">{res.ms} ms · on this phone</div>
          {res.answer && (
            <Card className="space-y-1 border-l-4 border-emerald-500">
              <div className="flex items-center gap-1 text-sm font-semibold text-emerald-800">
                <BadgeCheck size={16} /> मार्गदर्शन उत्तर · Guidance answer (review clinically)
              </div>
              <div className="font-semibold">{res.answer.payload.title}</div>
              <p className="text-sm text-slate-700">{res.answer.payload.text}</p>
              <div className="text-xs text-slate-500">
                {res.answer.payload.approved_by?.includes("(Demo)") ? "Starter example — not clinician verified" : (res.answer.payload.approved_by || res.answer.payload.source)} · similarity {res.answer.score.toFixed(2)}
              </div>
              <ListenButton text={res.answer.payload.text} />
            </Card>
          )}
          {res.passages.map((p) => (
            <Card key={p.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.payload.title}</span>
                {p.payload.kind === "alert" ? <Badge tone="rose">District alert</Badge> : <Badge tone="sky">Protocol</Badge>}
              </div>
              <p className="text-sm text-slate-700">{p.payload.text}</p>
              <ListenButton text={p.payload.text} />
              <div className="text-xs text-slate-500">
                {p.payload.source}
                {isExpired(p.payload) && <span className="font-semibold text-amber-700"> · expired advisory</span>}
              </div>
            </Card>
          ))}
          {!res.answer && settings && <AskDoctor key={asked} question={asked} village={settings.village} />}
          <p className="px-1 text-xs text-slate-500">Guidance summaries for support only. Follow official protocols and refer when in doubt.</p>
        </>
      )}
      <MyQuestions />
    </div>
  );
}

export default function SearchScreen() {
  const [tab, setTab] = useState<"patients" | "guidance">("patients");
  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "patients", label: <Bi hi="मरीज़" en="Patients" /> },
          { value: "guidance", label: <Bi hi="जानकारी" en="Guidance" /> },
        ]}
      />
      {tab === "patients" ? <PatientSearch /> : <Guidance />}
    </div>
  );
}
