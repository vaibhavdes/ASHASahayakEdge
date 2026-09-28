import { ArrowLeft, BookOpen, Cpu, House, Plus, RefreshCw, Search, Users, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Spinner, cx } from "./components/ui";
import { isNative } from "./lib/bridge";
import { startAutoSync } from "./lib/autosync";
import { isModelLoaded, loadModel } from "./lib/embedder";
import { useData, useSettingsState } from "./lib/hooks";
import { isGuidanceUpdating } from "./lib/sync";
import { setLang, tr } from "./lib/i18n";
import { resetDevice } from "./lib/starter";
import { resetSettingsCache, updateSettings } from "./lib/settings";
import { NavContext, type Route, type Tab } from "./lib/nav";
import { villageName } from "./lib/villages";
import Home from "./screens/Home";
import AddFamily from "./screens/AddFamily";
import HouseholdDetail from "./screens/HouseholdDetail";
import Households from "./screens/Households";
import Inspector from "./screens/Inspector";
import NewVisit from "./screens/NewVisit";
import { AlertPlan, LocalAlertPlan, Today } from "./screens/Plans";
import Reports from "./screens/Reports";
import SearchScreen, { Guidance } from "./screens/Search";
import Setup from "./screens/Setup";
import SyncScreen from "./screens/Sync";

const TABS: { id: Tab; hi: string; en: string; icon: typeof House }[] = [
  { id: "home", hi: "होम", en: "Home", icon: House },
  { id: "households", hi: "परिवार", en: "Families", icon: Users },
  { id: "visit", hi: "विज़िट", en: "Visit", icon: Plus },
  { id: "search", hi: "खोजें", en: "Search", icon: Search },
  { id: "sync", hi: "सिंक", en: "Sync", icon: RefreshCw },
];

export default function App() {
  const { settings, error: startupError, retry } = useSettingsState();
  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Route[]>([]);
  const { data: guidanceUpdating } = useData(async () => isGuidanceUpdating(), ["guidance"]);
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">(isModelLoaded() ? "ready" : "loading");

  useEffect(() => {
    if (!settings?.setupDone || !settings.deviceToken) return;
    loadModel().then(
      () => {
        setModelState("ready");
        startAutoSync();
      },
      () => setModelState("error"),
    );
  }, [settings?.setupDone]);

  const nav = useMemo(
    () => ({
      tab,
      setTab: (t: Tab) => {
        setStack([]);
        setTab(t);
      },
      push: (r: Route) => setStack((s) => [...s, r]),
      back: () => setStack((s) => s.slice(0, -1)),
    }),
    [tab],
  );

  if (!settings) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 bg-[#f1f5f4] p-6 text-center">
        <img src="/icon.svg" className="h-16 w-16" alt="" />
        <h1 className="text-xl font-bold text-teal-900">Sahayak Edge</h1>
        {startupError ? (
          <div className="space-y-3 rounded-xl bg-white p-4 text-sm text-rose-800 shadow-sm">
            <p>Phone data could not be opened. Your saved data has not been cleared.</p>
            <p className="break-words text-xs text-slate-600">{startupError}</p>
            <button className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white" onClick={retry}>Try again</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-slate-600"><Spinner /> Preparing phone data…</div>
        )}
      </div>
    );
  }
  setLang(settings.lang);
  if (!settings.setupDone) return <Setup />;
  if (!settings.deviceToken) return <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-4 p-6 text-center">
    <h1 className="text-xl font-bold">{tr("फ़ोन को फिर से शुरू करें", "Start fresh on this phone")}</h1>
    <p className="text-sm text-slate-600">{tr("इस फ़ोन पर ऐप के पुराने संस्करण का डेटा है। नई शुरुआत से यह डेटा इस फ़ोन से हटेगा और फ़ोन फिर से जुड़ेगा। ज़िले के सर्वर का डेटा नहीं बदलेगा।", "This phone has data from an older version of the app. Starting fresh clears it from this phone and registers the phone again. Records on the district server are not changed.")}</p>
    <button className="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white" onClick={async () => {
      if (!confirm(tr("पुराना डेटा हटाकर नई शुरुआत करें?", "Clear the older data on this phone and start fresh?"))) return;
      await resetDevice(); resetSettingsCache(); location.reload();
    }}>{tr("नई शुरुआत करें", "Start fresh")}</button>
  </div>;

  const top = stack[stack.length - 1];
  let screen;
  if (top?.screen === "addFamily") screen = <AddFamily />;
  else if (top?.screen === "household") screen = <HouseholdDetail id={top.id} />;
  else if (top?.screen === "inspector") screen = <Inspector />;
  else if (top?.screen === "alert") screen = <AlertPlan id={top.id} />;
  else if (top?.screen === "localAlert") screen = <LocalAlertPlan syndromes={top.syndromes} title={top.title} />;
  else if (top?.screen === "today") screen = <Today />;
  else if (top?.screen === "reports") screen = <Reports />;
  else if (top?.screen === "guidance") screen = <div className="space-y-4">
    <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800"><ArrowLeft size={18} /> {tr("वापस", "Back")}</button>
    <Guidance initial={top.q} />
  </div>;
  else if (top?.screen === "visit") screen = <NewVisit householdId={top.householdId} memberId={top.memberId} />;
  else if (tab === "home") screen = <Home />;
  else if (tab === "households") screen = <Households />;
  else if (tab === "visit") screen = <NewVisit />;
  else if (tab === "search") screen = <SearchScreen />;
  else screen = <SyncScreen />;

  const offline = settings.network === "offline";

  return (
    <NavContext.Provider value={nav}>
      <div className="mx-auto flex h-full max-w-md flex-col bg-[#f1f5f4]">
        <header className="safe-top sticky top-0 z-10 bg-teal-800 text-white">
          <div className="flex items-center gap-3 px-4 py-3">
            <img src="/icon.svg" className="h-8 w-8 rounded-lg" alt="" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold">Sahayak Edge</div>
              <div className="truncate text-xs text-teal-100">
                {settings.role} · {settings.name} · {villageName(settings.village)}
              </div>
            </div>
            {offline ? (
              <Badge tone="amber">
                <WifiOff size={12} /> {tr("ऑफ़लाइन", "Offline")}
              </Badge>
            ) : null}
            <button onClick={() => nav.push({ screen: "guidance" })} className="rounded-lg p-2 active:bg-teal-700" aria-label={tr("स्वास्थ्य जानकारी खोजें", "Search health guidance")}>
              <BookOpen size={20} />
            </button>
            <button
              onClick={() => updateSettings({ lang: settings.lang === "hi" ? "en" : "hi" })}
              className="min-w-9 rounded-lg px-2 py-1.5 text-sm font-bold ring-1 ring-teal-500 active:bg-teal-700"
              aria-label="Language / भाषा"
            >
              {settings.lang === "hi" ? "EN" : "हि"}
            </button>
            <button onClick={() => nav.push({ screen: "inspector" })} className="rounded-lg p-2 active:bg-teal-700" aria-label={tr("फ़ोन के अंदर", "Under the hood")}>
              <Cpu size={20} />
            </button>
          </div>
          {!isNative && <div className="bg-amber-400 px-4 py-1 text-center text-xs font-medium text-amber-950">Browser preview: the offline database runs only in the Android app</div>}
          {guidanceUpdating && (
            <div className="bg-sky-700 px-4 py-1.5 text-center text-xs">
              {tr("ज़िले से नई जानकारी आ रही है…", "New guidance arriving from the district…")}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-sky-900">
                <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-white" />
              </div>
            </div>
          )}
          {modelState !== "ready" && (
            <div className={cx("px-4 py-1 text-center text-xs", modelState === "error" ? "bg-rose-600" : "bg-teal-700")}>
              {modelState === "error" ? tr("खोज अभी तैयार नहीं है। ऐप फिर से खोलें।", "Search is not ready yet. Reopen the app.") : tr("ऐप तैयार हो रहा है…", "Getting ready…")}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4">{screen}</main>

        <nav className="safe-bottom sticky bottom-0 grid grid-cols-5 border-t border-slate-200 bg-white">
          {TABS.map((t) => {
            const active = !top && tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => nav.setTab(t.id)} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-teal-800" : "text-slate-500")}>
                {t.id === "visit" ? (
                  <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg ring-4 ring-white">
                    <Icon size={26} />
                  </span>
                ) : (
                  <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                )}
                <span className="font-semibold">{settings.lang === "hi" ? t.hi : t.en}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </NavContext.Provider>
  );
}
