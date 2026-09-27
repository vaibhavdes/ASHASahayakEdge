import { tr } from "../lib/i18n";
import { AlertTriangle, ArrowLeft, Lock, Save, Send } from "lucide-react";
import { StartCard } from "../components/StartCard";
import { useMemo, useState } from "react";
import { Badge, Bi, Button, Card, Section, Spinner, SyncBadge, SyndromeBadges } from "../components/ui";
import { ListenButton } from "../components/ListenButton";
import { VoiceButton } from "../components/VoiceButton";
import { allHouseholds } from "../lib/households";
import { useData, useSettings } from "../lib/hooks";
import { ask, type AskResult } from "../lib/knowledge";
import { addVisit, visitContext } from "../lib/memory";
import { useNav } from "../lib/nav";
import { buildSignal } from "../lib/policy";
import { tagByRules, type Tagging } from "../lib/tagger";
import type { Visit } from "../lib/types";

// Quick phrases for common findings.
const PHRASES = ["बुखार", "दस्त", "उल्टी", "दाने", "खांसी", "सांस तेज़", "झटके", "खून बह रहा", "सिर दर्द", "सूजन", "दूध नहीं पी रहा", "ORS दिया", "IFA दी", "टीका लगाया"];

export default function NewVisit({ householdId, memberId }: { householdId?: string; memberId?: string }) {
  const nav = useNav();
  const settings = useSettings();
  const { data: households } = useData(allHouseholds, ["households"]);
  const [hid, setHid] = useState(householdId ?? "");
  const [mid, setMid] = useState(memberId ?? "");
  const [find, setFind] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ visit: Visit; tagging: Tagging; ms: number; guidance: AskResult | null } | null>(null);

  const household = hid ? households?.[hid] : undefined;
  const member = household?.fields.members.value.find((m) => m.id === mid);
  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const pregnant = !!member && household?.fields.pregnant_member.value === member.id;
    return tagByRules(`${text} ${member ? visitContext(pregnant, member.age) : ""}`);
  }, [text, member, household]);
  const matches = useMemo(() => {
    const n = find.trim().toLowerCase();
    return Object.values(households ?? {})
      .filter((h) => !n || h.house_no.toLowerCase().includes(n) || h.fields.members.value.some((m) => m.name.toLowerCase().includes(n)))
      .slice(0, 6);
  }, [households, find]);

  async function save() {
    if (!household || !settings || !member) return;
    setSaving(true);
    try {
      const r = await addVisit({ household, member, text, role: settings.role, deviceId: settings.deviceId });
      const guidance = r.tagging.danger ? await ask(text) : null;
      setResult({ ...r, guidance });
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    const { visit, guidance } = result;
    const signal = visit.sync_class !== "never" ? buildSignal(visit) : null;
    return (
      <div className="space-y-4">
        {visit.danger && (
          <Card className="border-l-4 border-rose-600 bg-rose-50">
            <div className="flex items-center gap-2 text-lg font-bold text-rose-700">
              <AlertTriangle /> {tr("खतरे का संकेत — तुरंत रेफर करें", "Danger sign — refer now")}
            </div>
            <p className="text-sm text-rose-900">{tr("108/102 पर कॉल करें और ANM को बताएं।", "Call 108/102 and inform the ANM.")}</p>
            {guidance?.answer && <p className="mt-2 text-sm text-slate-800">{guidance.answer.payload.text}</p>}
            {!guidance?.answer && guidance?.passages[0] && <p className="mt-2 text-sm text-slate-800">{guidance.passages[0].payload.text}</p>}
            {(guidance?.answer ?? guidance?.passages[0]) && <ListenButton className="mt-2" text={(guidance.answer ?? guidance.passages[0]).payload.text} />}
          </Card>
        )}
        <Card className="space-y-2">
          <div className="font-semibold">✓ {tr("फ़ोन पर सेव हो गया", "Saved on this phone")}</div>
          <div className="text-sm text-slate-600">{visit.member_name}</div>
          <SyndromeBadges syndromes={visit.syndromes} danger={visit.danger} />
        </Card>

        <Section title={<Bi hi="क्या फ़ोन से बाहर जाएगा?" en="What leaves this phone?" />}>
          <Card className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Lock size={16} className="text-slate-600" /> {tr("विज़िट नोट इसी फ़ोन पर रहेगा।", "The visit note stays on this phone.")}
            </div>
            {signal ? (
              <>
                <div className="flex items-center gap-2">
                  <Send size={16} className="text-teal-700" /> {tr("सिर्फ़ लक्षण ज़िले को जाएंगे, नाम नहीं।", "Only the symptoms go to the district, never the name.")} <SyncBadge cls={visit.sync_class} />
                </div>
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer">{tr("देखें क्या भेजा जाएगा", "See exactly what is sent")}</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-2 text-[11px] text-emerald-200">
                    {JSON.stringify({ ...signal, id: "random-uuid", vector_q8: "384 bytes (int8)" }, null, 1)}
                  </pre>
                </details>
              </>
            ) : (
              <div className="text-slate-600">{tr("सामान्य विज़िट: कुछ नहीं भेजा जाएगा।", "Routine visit: nothing is sent.")}</div>
            )}
          </Card>
        </Section>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => { setResult(null); setText(""); }}>
            {tr("+ एक और", "+ Another")}
          </Button>
          <Button onClick={() => (householdId ? nav.back() : nav.setTab("home"))}>{tr("हो गया", "Done")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {householdId && (
        <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
          <ArrowLeft size={18} /> {tr("वापस", "Back")}
        </button>
      )}
      <h1 className="text-xl font-bold">
        <Bi hi="नई विज़िट" en="New visit" />
      </h1>

      {!household ? (
        <Section title={<Bi hi="परिवार चुनें" en="Choose household" />}>
          {households && !Object.keys(households).length && <StartCard />}
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tr("नाम / घर नंबर", "name / house no.")} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3" />
          {matches.map((h) => (
            <Card key={h.id} onClick={() => setHid(h.id)} className="py-3">
              <div className="font-semibold">{h.fields.head.value}</div>
              <div className="text-xs text-slate-500">{h.house_no} · {h.fields.members.value.map((m) => m.name.split(" ")[0]).join(", ")}</div>
            </Card>
          ))}
        </Section>
      ) : (
        <>
          <Card className="flex items-center justify-between py-3">
            <div>
              <div className="font-semibold">{household.fields.head.value}</div>
              <div className="text-xs text-slate-500">{household.house_no}</div>
            </div>
            {!householdId && (
              <button className="text-sm text-teal-700" onClick={() => { setHid(""); setMid(""); }}>
                {tr("बदलें", "change")}
              </button>
            )}
          </Card>
          <Section title={<Bi hi="किसकी विज़िट?" en="Who is this visit for?" />}>
            <div className="flex flex-wrap gap-2">
              {household.fields.members.value.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMid(m.id)}
                  className={`min-h-11 rounded-xl px-3 text-sm font-medium ring-1 ${mid === m.id ? "bg-teal-700 text-white ring-teal-700" : "bg-white ring-slate-300"}`}
                >
                  {m.name.split(" ")[0]} · {m.age}
                </button>
              ))}
            </div>
          </Section>
          <Section title={<Bi hi="क्या देखा? बोलिए या लिखिए" en="What did you observe? Speak or type" />}>
            <VoiceButton onText={(spoken) => setText((t) => (t ? `${t} ${spoken}` : spoken))} />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={tr("जैसे: बच्चे को 2 दिन से बुखार और दाने", "e.g. child has fever and rash for 2 days")}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-base"
            />
            <p className="px-1 text-xs text-slate-500">
              {tr("कीबोर्ड के 🎤 से भी बोल सकते हैं", "you can also use the mic on your keyboard")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PHRASES.map((p) => (
                <button key={p} onClick={() => setText((t) => (t ? `${t}, ${p}` : p))} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300 active:bg-teal-50">
                  + {p}
                </button>
              ))}
            </div>
            {preview && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {tr("समझा गया:", "Understood:")} <SyndromeBadges syndromes={preview.syndromes} danger={preview.danger} />
                {preview.danger && <Badge tone="rose">{tr("खतरा", "danger")}</Badge>}
              </div>
            )}
          </Section>
          <Button className="w-full" disabled={!mid || !text.trim() || saving} onClick={save}>
            {saving ? <Spinner /> : <Save size={20} />} {tr("सेव करें", "Save")}
          </Button>
        </>
      )}
    </div>
  );
}
