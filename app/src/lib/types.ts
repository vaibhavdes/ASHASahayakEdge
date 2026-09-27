export type Shard = "memory" | "knowledge" | "state";
export type SearchMode = "hybrid" | "dense" | "sparse" | "diverse";
export type Role = "ASHA" | "ANM";
export type NetworkMode = "online" | "2g" | "offline";

/** Qdrant filter JSON, same shape as the Qdrant REST API. */
export type Filter = Record<string, unknown>;

export interface PointIn {
  id: string;
  dense: number[];
  text: string;
  payload: Record<string, unknown>;
}

export interface Hit<P = Record<string, any>> {
  id: string;
  score: number;
  payload: P;
}

export interface QueryIn {
  dense: number[];
  text: string;
  filter?: Filter | null;
  limit: number;
  mode: SearchMode;
  weights?: [number, number];
  recency?: { key: string; now: string; half_life_days: number; weight: number };
  score_threshold?: number;
}

export interface ShardInfo {
  shard: Shard;
  points: number;
  indexed_vectors: number;
  segments: number;
  payload_indexes: string[];
  disk_bytes: number;
  vectors: Record<string, Record<string, unknown>>;
}

/** Where a record is allowed to go. The heart of the privacy design. */
export type SyncClass = "never" | "registry" | "signal" | "urgent";
export type SyncStatus = "local" | "pending" | "synced";

export interface Visit {
  kind: "visit";
  visit_id: string;
  household_id: string;
  member_id: string;
  member_name: string;
  house_no: string;
  village: string;
  ward: string;
  sex: "M" | "F";
  age_band: string;
  pregnant: boolean;
  visit_at: string;
  text: string;
  syndromes: string[];
  danger: boolean;
  /** What was done: anc, immunization, mr_vaccine, newborn_care, referral. */
  activities: string[];
  tag_method: "rule" | "ai" | "none";
  sync_class: SyncClass;
  sync_status: SyncStatus;
  loc?: { lat: number; lon: number };
  author_role: Role;
  device_id: string;
  /** Id of the anonymous signal made from this visit. Kept on the phone only, so a
   *  correction can retract that signal without the cloud learning whose it was. */
  signal_id?: string;
  edited_at?: string;
}

export interface KnowledgeDoc {
  kind: "protocol" | "answer" | "alert";
  title: string;
  /** For answers: the phrasing this vector represents (one point per approved phrasing). */
  question?: string;
  text: string;
  source: string;
  topic?: string;
  villages?: string[];
  severity?: "info" | "watch" | "alert";
  published_at: string;
  expires_at?: string | null;
  version?: number;
  approved_by?: string;
}

/** A value with its version, for field-level merge of household records. */
export interface Versioned<T = unknown> {
  value: T;
  ts: number; // Lamport-style counter from the registry
  dev: string; // device that wrote it
  dirty?: boolean; // changed locally, not yet accepted by the registry
  base?: number; // registry ts this local edit was based on
}

export interface Member {
  id: string;
  name: string;
  sex: "M" | "F";
  age: number;
}

export interface Household {
  id: string;
  village: string;
  ward: string;
  house_no: string;
  lat: number;
  lon: number;
  fields: {
    head: Versioned<string>;
    phone: Versioned<string>;
    members: Versioned<Member[]>;
    pregnant_member: Versioned<string | null>;
    edd: Versioned<string | null>;
    high_risk: Versioned<boolean>;
  };
}

export type HouseholdField = keyof Household["fields"];

export interface OutboxItem {
  id: string;
  kind: "signal" | "household" | "report" | "question" | "retract";
  priority: 0 | 1 | 2; // 0 urgent, 1 signal, 2 registry / reports / questions
  created_at: string;
  attempts: number;
  bytes: number;
  payload: Record<string, unknown>;
  label: string;
  /** Local reference (e.g. the visit id). Never sent: signals must stay unlinkable. */
  ref?: string;
}

export interface Conflict {
  household_id: string;
  field: HouseholdField;
  mine: unknown;
  theirs: unknown;
  theirs_ts: number;
  theirs_dev: string;
  at: string;
}

export interface Alert {
  id: string;
  title: string;
  text: string;
  severity: "info" | "watch" | "alert";
  villages: string[];
  syndromes: string[];
  created_at: string;
  expires_at?: string | null;
}

export interface ActivityEntry {
  at: string;
  type: "visit" | "search" | "sync" | "alert" | "conflict" | "knowledge" | "system";
  text: string;
  ms?: number;
}

export interface MyQuestion {
  id: string;
  question: string;
  asked_at: string;
  status: "queued" | "sent" | "answered";
  answer_title?: string;
  answer_text?: string;
  answered_at?: string;
}
