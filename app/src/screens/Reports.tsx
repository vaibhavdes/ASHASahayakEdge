import { tr } from "../lib/i18n";
import { ArrowLeft, CheckCircle2, Send } from "lucide-react";
import { useState } from "react";
import { Bi, Button, Card, Segmented } from "../components/ui";
import { useData, useSettings } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { MONTH_ROWS, S_FORM_ROWS, monthPeriod, monthlySummary, sForm, submitReport, submittedReports, weekPeriod } from "../lib/reports";

export default function Reports() {
  const nav = useNav();
  const settings = useSettings();
  const [kind, setKind] = useState<"s_form" | "monthly">("s_form");
  const [offset, setOffset] = useState<"0" | "1">("0");
  const [deaths, setDeaths] = useState(0);
  const village = settings?.village ?? "";
  const period = kind === "s_form" ? weekPeriod(Number(offset)) : monthPeriod(Number(offset));
  const { data: form } = useData(() => sForm(village, period), ["memory"], [village, period.id, kind]);
  const { data: month } = useData(() => monthlySummary(village, period), ["memory"], [village, period.id, kind]);
  const { data: sent } = useData(submittedReports, ["outbox"]);
  const submitted = sent?.has(`report:${kind}:${village}:${period.id}`);

  return (
    <div className="space-y-4">
      <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
        <ArrowLeft size={18} /> {tr("वापस", "Back")}
      </button>
      <h1 className="text-lg font-bold">
        <Bi hi="रिपोर्ट — अपने आप भरी हुई" en="Reports, filled from your visits" />
      </h1>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "s_form", label: <Bi hi="साप्ताहिक S-फ़ॉर्म" en="Weekly S-form" /> },
          { value: "monthly", label: <Bi hi="मासिक सारांश" en="Monthly summary" /> },
        ]}
      />
      <Segmented
        value={offset}
        onChange={setOffset}
        options={[
          { value: "0", label: kind === "s_form" ? tr("इस हफ्ते", "this week") : tr("इस महीने", "this month") },
          { value: "1", label: kind === "s_form" ? tr("पिछला हफ्ता", "last week") : tr("पिछला महीना", "last month") },
        ]}
      />
      <Card className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{period.label}</span>
          <span className="text-xs text-slate-500">{kind === "s_form" ? `from ${form?.visits ?? "…"} visits` : ""}</span>
        </div>
        {kind === "s_form" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1">{tr("लक्षण", "syndrome")}</th>
                <th className="py-1 text-right">&lt;5 yr</th>
                <th className="py-1 text-right">5+ yr</th>
              </tr>
            </thead>
            <tbody>
              {S_FORM_ROWS.map((r) => {
                const row = form?.rows.find((x) => x.key === r.key);
                return (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="py-1.5">
                      <Bi hi={r.hi} en={r.en} />
                    </td>
                    <td className="text-right font-semibold">{row?.under5 ?? "–"}</td>
                    <td className="text-right font-semibold">{row?.over5 ?? "–"}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-slate-100">
                <td className="py-1.5">
                  <Bi hi="मृत्यु / असामान्य घटना" en="Deaths / unusual events (enter)" />
                </td>
                <td colSpan={2} className="text-right">
                  <input type="number" min={0} value={deaths} onChange={(e) => setDeaths(Math.max(0, Number(e.target.value)))} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right" />
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {MONTH_ROWS.map((r) => (
                <tr key={r.key} className="border-t border-slate-100 first:border-0">
                  <td className="py-1.5">
                    <Bi hi={r.hi} en={r.en} />
                  </td>
                  <td className="text-right font-semibold">{month?.[r.key] ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-slate-500">{tr("फ़ोन पर दर्ज विज़िट से गिना गया। सिर्फ़ ये गिनती भेजी जाती है, नाम कभी नहीं।", "Counted from the visits on this phone. Only these numbers are sent, never names.")}</p>
      </Card>
      {submitted ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={18} /> {tr("भेजने के लिए तैयार", "queued, goes with the next sync")}
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={!village}
          onClick={() => (kind === "s_form" ? submitReport("s_form", village, period, form?.rows ?? [], { deaths }) : submitReport("monthly", village, period, month ?? {}))}
        >
          <Send size={18} /> {tr("जांचा, भेजें", "Checked, submit")}
        </Button>
      )}
    </div>
  );
}
