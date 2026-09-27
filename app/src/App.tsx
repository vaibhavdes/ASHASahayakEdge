import { Cpu, House, Plus, RefreshCw, Search, Users, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Spinner, cx } from "./components/ui";
import { isNative } from "./lib/bridge";
import { startAutoSync } from "./lib/autosync";
import { isModelLoaded, loadModel } from "./lib/embedder";
import { useSettingsState } from "./lib/hooks";
import { NavContext, type Route, type Tab } from "./lib/nav";
import { villageName } from "./lib/villages";
import Home from "./screens/Home";
import HouseholdDetail from "./screens/HouseholdDetail";
import Households from "./screens/Households";
import Inspector from "./screens/Inspector";
import NewVisit from "./screens/NewVisit";
import { AlertPlan, LocalAlertPlan, Today } from "./screens/Plans";
import Reports from "./screens/Reports";
import SearchScreen from "./screens/Search";
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
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">(isModelLoaded() ? "ready" : "loading");

  useEffect(() => {
    if (!settings?.setupDone) return;
    const host = settings.modelSource === "cloud" ? `${settings.cloudUrl.replace(/\/$/, "")}/models/` : undefined;
    loadModel(undefined, host).then(
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
  if (!settings.setupDone) return <Setup />;

  const top = stack[stack.length - 1];
  let screen;
  if (top?.screen === "household") screen = <HouseholdDetail id={top.id} />;
  else if (top?.screen === "inspector") screen = <Inspector />;
  else if (top?.screen === "alert") screen = <AlertPlan id={top.id} />;
  else if (top?.screen === "localAlert") screen = <LocalAlertPlan syndromes={top.syndromes} title={top.title} />;
  else if (top?.screen === "today") screen = <Today />;
  else if (top?.screen === "reports") screen = <Reports />;
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
                <WifiOff size={12} /> ऑफ़लाइन
              </Badge>
            ) : settings.network === "2g" ? (
              <Badge tone="amber">2G</Badge>
            ) : null}
            <button onClick={() => nav.push({ screen: "inspector" })} className="rounded-lg p-2 active:bg-teal-700" aria-label="Inspector">
              <Cpu size={20} />
            </button>
          </div>
          {!isNative && <div className="bg-amber-400 px-4 py-1 text-center text-xs font-medium text-amber-950">Browser preview — Qdrant Edge runs only in the Android app</div>}
          {modelState !== "ready" && (
            <div className={cx("px-4 py-1 text-center text-xs", modelState === "error" ? "bg-rose-600" : "bg-teal-700")}>
              {modelState === "error" ? "AI मॉडल लोड नहीं हुआ · AI model failed to load (see Settings)" : "AI मॉडल लोड हो रहा है… · Loading on-device AI…"}
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
                <span className="font-semibold">{t.hi}</span>
                <span className="-mt-0.5 opacity-70">{t.en}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </NavContext.Provider>
  );
}
