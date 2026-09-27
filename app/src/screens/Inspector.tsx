import { ArrowLeft, Database } from "lucide-react";
import { useState } from "react";
import { Badge, Bi, Card, Section, Segmented, Stat, SyncBadge } from "../components/ui";
import { SettingsCard } from "../components/SettingsCard";
import { VoiceSetup } from "../components/VoiceSetup";
import { getActivity } from "../lib/activity";
import { edge, isNative } from "../lib/bridge";
import { useData, useSettings } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { ago } from "../lib/time";
import type { Shard } from "../lib/types";

const kb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function ShardPanel({ shard }: { shard: Shard }) {
  const { data: info } = useData(() => edge.info(shard), ["memory", "alerts", "sync"], [shard]);
  const { data: page } = useData(() => edge.scroll(shard, 25, null, null), ["memory", "alerts", "sync"], [shard]);
  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Database size={18} className="text-teal-700" /> Qdrant Edge shard “{shard}”
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="points" value={info?.points ?? "–"} />
          <Stat label="on disk" value={info ? kb(info.disk_bytes) : "–"} />
          <Stat label="segments" value={info?.segments ?? "–"} />
        </div>
        <div className="space-y-1 text-xs text-slate-600">
          <div>
            <b>Vectors:</b>{" "}
            {shard === "state" ? "none: app records stored as payload-only points" : "dense 384-d cosine, int8 quantised (multilingual MiniLM) + BM25 sparse (IDF)"}
          </div>
          <div>
            <b>Payload indexes:</b> {info?.payload_indexes.join(", ") || "—"}
          </div>
          <div>
            <b>Holds:</b>{" "}
            {shard === "memory"
              ? "visit notes; never synced as-is"
              : shard === "knowledge"
                ? "guidance and alerts from the district, updated by Qdrant snapshots"
                : "households, outbox, settings, activity log, conflicts, questions"}
          </div>
        </div>
      </Card>
      <Section title={`First ${page?.points.length ?? 0} points`}>
        {page?.points.map((p) => (
          <Card key={p.id} className="space-y-1 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-slate-500">{p.id}</span>
              {p.payload.kind === "visit" ? <SyncBadge cls={p.payload.sync_class} status={p.payload.sync_status} /> : <Badge tone="sky">{p.payload.kind ?? "record"}</Badge>}
            </div>
            <div className="line-clamp-2 text-slate-700">{p.payload.text ?? p.payload.title ?? p.payload.name}</div>
          </Card>
        ))}
      </Section>
    </div>
  );
}

function ActivityPanel() {
  const { data } = useData(getActivity, ["activity"]);
  return (
    <div className="space-y-2">
      {data?.map((a, i) => (
        <Card key={i} className="py-2 text-xs">
          <div className="flex items-center justify-between">
            <Badge tone={a.type === "alert" || a.type === "conflict" ? "rose" : a.type === "sync" ? "emerald" : "slate"}>{a.type}</Badge>
            <span className="text-slate-500">
              {ago(a.at)}
              {a.ms != null && ` · ${a.ms} ms`}
            </span>
          </div>
          <div className="mt-1 text-slate-700">{a.text}</div>
        </Card>
      ))}
    </div>
  );
}

export default function Inspector() {
  const nav = useNav();
  const settings = useSettings();
  const [tab, setTab] = useState<"memory" | "knowledge" | "state" | "activity">("memory");
  return (
    <div className="space-y-4">
      <button onClick={nav.back} className="flex items-center gap-1 text-sm font-medium text-teal-800">
        <ArrowLeft size={18} /> वापस · Back
      </button>
      <h1 className="text-xl font-bold">
        <Bi hi="डिवाइस मेमोरी" en="Device memory inspector" />
      </h1>
      <Card className="space-y-1 text-xs text-slate-600">
        <div>
          Storage: <b>{isNative ? "Qdrant Edge only (in-process, three shards)" : "browser preview (not Qdrant)"}</b>
        </div>
        <div>
          Device: <span className="font-mono">{settings?.deviceId.slice(0, 8)}</span> · {settings?.role} · guidance v{settings?.knowledgeVersion}
        </div>
        <div>AI: paraphrase-multilingual-MiniLM-L12-v2 (int8 ONNX, runs in the app)</div>
      </Card>
      <SettingsCard />
      <VoiceSetup />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "memory", label: "Memory" },
          { value: "knowledge", label: "Knowledge" },
          { value: "state", label: "State" },
          { value: "activity", label: "Activity" },
        ]}
      />
      {tab === "activity" ? <ActivityPanel /> : <ShardPanel shard={tab} />}
    </div>
  );
}
