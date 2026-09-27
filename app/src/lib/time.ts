export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

export function isoWeek(date: Date | string): string {
  const d = new Date(typeof date === "string" ? date : date.getTime());
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "कभी नहीं · never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "अभी · just now";
  if (mins < 60) return `${mins} मिनट पहले · ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} घंटे पहले · ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} दिन पहले · ${days} days ago`;
}

export const daysSince = (iso: string | null | undefined) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity;

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
