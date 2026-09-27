import { tr } from "../lib/i18n";
import { ArrowLeft, MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Card } from "../components/ui";
import { createHousehold } from "../lib/households";
import { useSettings } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { currentPosition } from "../lib/location";
import { VILLAGES } from "../lib/villages";

export default function AddFamily() {
  const nav = useNav();
  const settings = useSettings();
  const [head, setHead] = useState("");
  const [locality, setLocality] = useState("");
  const [houseNo, setHouseNo] = useState("");
  const [memberName, setMemberName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"F" | "M">("F");
  const [pregnant, setPregnant] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState(tr("क्षेत्र की अनुमानित लोकेशन ली जाएगी।", "Using the selected area's approximate location."));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canBePregnant = sex === "F" && Number(age) >= 12 && Number(age) <= 55;
  if (!settings) return null;
  const area = settings.village;
  const selected = VILLAGES.find((v) => v.code === area)!;

  async function locate() {
    const pos = await currentPosition();
    setGps(pos);
    setLocationMessage(pos ? tr("लोकेशन सिर्फ़ इस फ़ोन पर सेव हुई।", "Phone location saved on this phone only.") : tr("लोकेशन नहीं मिली, क्षेत्र की लोकेशन ली जाएगी।", "Location unavailable. Your selected area will be used."));
  }

  async function save() {
    if (!settings) return;
    if (!head.trim() || !memberName.trim() || !age.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await createHousehold({ village: area, locality, houseNo, head, members: [{ name: memberName, age: Number(age), sex, pregnant: canBePregnant && pregnant }], lat: gps?.lat ?? selected.lat, lon: gps?.lon ?? selected.lon, deviceId: settings.deviceId });
      nav.setTab("households");
      nav.push({ screen: "visit", householdId: result.household.id, memberId: result.memberId });
    } catch (e) { setError(String(e)); setBusy(false); }
  }

  return <div className="space-y-4">
    <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800"><ArrowLeft size={18} /> {tr("वापस", "Back")}</button>
    <div><h1 className="text-xl font-bold">{tr("नया परिवार", "Add family")}</h1><p className="text-sm text-slate-600">{tr("एक सदस्य जोड़ें, फिर तुरंत विज़िट दर्ज करें।", "Add one member, then record a visit right away.")}</p></div>
    <Card className="space-y-3">
      <div className="text-sm font-semibold">{tr("क्षेत्र", "Assigned area")}: {selected.name}</div>
      <label className="block text-sm font-semibold">{tr("मोहल्ला या गली (वैकल्पिक)", "Locality or lane (optional)")}
        <input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder={tr("जैसे: कुम्भारवाड़ा", "e.g. Kumbharwada")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <button onClick={locate} className="flex items-center gap-2 text-sm font-semibold text-teal-700"><MapPin size={18} /> {tr("फ़ोन की लोकेशन लें (वैकल्पिक)", "Use phone location (optional)")}</button>
      <p className="text-xs text-slate-500">{locationMessage}</p>
      <label className="block text-sm font-semibold">{tr("परिवार के मुखिया का नाम", "Family contact name")}
        <input value={head} onChange={(e) => setHead(e.target.value)} placeholder={tr("जैसे: आशा पाटिल", "e.g. Asha Patil")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <label className="block text-sm font-semibold">{tr("घर या गली की पहचान (वैकल्पिक)", "House or street reference (optional)")}
        <input value={houseNo} onChange={(e) => setHouseNo(e.target.value)} placeholder={tr("जैसे: बिल्डिंग 4", "e.g. Building 4")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
    </Card>
    <Card className="space-y-3">
      <h2 className="font-semibold">{tr("पहला सदस्य", "First member")}</h2>
      <label className="block text-sm font-semibold">{tr("नाम", "Name")}
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">{tr("उम्र", "Age")}
          <input value={age} onChange={(e) => setAge(e.target.value)} type="number" min="0" max="120" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
        </label>
        <label className="text-sm font-semibold">{tr("लिंग", "Sex")}
          <select value={sex} onChange={(e) => setSex(e.target.value as "F" | "M")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="F">{tr("महिला", "Female")}</option><option value="M">{tr("पुरुष", "Male")}</option></select>
        </label>
      </div>
      {canBePregnant && (
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={pregnant} onChange={(e) => setPregnant(e.target.checked)} className="h-6 w-6 accent-violet-600" />
          {tr("गर्भवती है", "Currently pregnant")}
        </label>
      )}
    </Card>
    {error && <p className="text-sm text-rose-700">{error}</p>}
    <Button className="w-full" disabled={busy || !head.trim() || !memberName.trim() || !age.trim() || Number(age) < 0 || Number(age) > 120} onClick={save}><Plus size={18} /> {tr("सेव करें और विज़िट दर्ज करें", "Save family & record visit")}</Button>
    <p className="text-xs text-slate-500">{tr("परिवार की जानकारी आपके क्षेत्र के फ़ोन से सिंक होती है।", "Family details sync with phones in your area.")}</p>
  </div>;
}
