import { ArrowLeft, MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Card } from "../components/ui";
import { createHousehold } from "../lib/households";
import { useSettings } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { isNative } from "../lib/bridge";
import { VILLAGES } from "../lib/villages";
import { checkPermissions, getCurrentPosition, requestPermissions } from "@tauri-apps/plugin-geolocation";

export default function AddFamily() {
  const nav = useNav();
  const settings = useSettings();
  const [head, setHead] = useState("");
  const [locality, setLocality] = useState("");
  const [houseNo, setHouseNo] = useState("");
  const [memberName, setMemberName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"F" | "M">("F");
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState("Using the selected area's approximate location.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!settings) return null;
  const area = settings.village;
  const selected = VILLAGES.find((v) => v.code === area)!;

  async function locate() {
    if (isNative) {
      try {
        let permissions = await checkPermissions();
        if (permissions.location === "prompt" || permissions.location === "prompt-with-rationale") permissions = await requestPermissions(["location"]);
        if (permissions.location !== "granted") throw new Error("permission denied");
        const pos = await getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
        setGps({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocationMessage("Phone location saved locally. The cloud receives only your selected area.");
      } catch { setGps(null); setLocationMessage("Location unavailable or denied. Your selected area will be used."); }
      return;
    }
    if (!navigator.geolocation) { setLocationMessage("GPS unavailable. Your selected area will be used."); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setGps({ lat: coords.latitude, lon: coords.longitude }); setLocationMessage("GPS saved on this phone. The cloud receives only your selected area."); },
      () => { setGps(null); setLocationMessage("GPS unavailable or denied. Your selected area will be used."); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }

  async function save() {
    if (!settings) return;
    if (!head.trim() || !memberName.trim() || !age.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await createHousehold({ village: area, locality, houseNo, head, memberName, memberAge: Number(age), memberSex: sex, lat: gps?.lat ?? selected.lat, lon: gps?.lon ?? selected.lon, deviceId: settings.deviceId });
      nav.setTab("households");
      nav.push({ screen: "visit", householdId: result.household.id, memberId: result.memberId });
    } catch (e) { setError(String(e)); setBusy(false); }
  }

  return <div className="space-y-4">
    <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800"><ArrowLeft size={18} /> Back</button>
    <div><h1 className="text-xl font-bold">नया परिवार · Add family</h1><p className="text-sm text-slate-600">Add one member, then record a visit right away.</p></div>
    <Card className="space-y-3">
      <div className="text-sm font-semibold">Assigned area: {selected.name}</div>
      <label className="block text-sm font-semibold">Locality or lane (optional)
        <input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="e.g. Kumbharwada" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <button onClick={locate} className="flex items-center gap-2 text-sm font-semibold text-teal-700"><MapPin size={18} /> Use phone location (optional)</button>
      <p className="text-xs text-slate-500">{locationMessage}</p>
      <label className="block text-sm font-semibold">Family contact name
        <input value={head} onChange={(e) => setHead(e.target.value)} placeholder="e.g. Asha Patil (fictional for demo)" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <label className="block text-sm font-semibold">House or street reference (optional)
        <input value={houseNo} onChange={(e) => setHouseNo(e.target.value)} placeholder="e.g. Building 4" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
    </Card>
    <Card className="space-y-3">
      <h2 className="font-semibold">First member</h2>
      <label className="block text-sm font-semibold">Name
        <input value={memberName} onChange={(e) => setMemberName(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Age
          <input value={age} onChange={(e) => setAge(e.target.value)} type="number" min="0" max="120" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
        </label>
        <label className="text-sm font-semibold">Sex
          <select value={sex} onChange={(e) => setSex(e.target.value as "F" | "M")} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="F">Female</option><option value="M">Male</option></select>
        </label>
      </div>
    </Card>
    {error && <p className="text-sm text-rose-700">{error}</p>}
    <Button className="w-full" disabled={busy || !head.trim() || !memberName.trim() || !age.trim() || Number(age) < 0 || Number(age) > 120} onClick={save}><Plus size={18} /> Save family & record visit</Button>
    <p className="text-xs text-slate-500">Family names and member details sync to enrolled phones in this area. Enter fictional people for evaluation.</p>
  </div>;
}
