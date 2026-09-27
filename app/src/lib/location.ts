// Phone location, used to pre-select the work area at setup and to place a new family.
import { checkPermissions, getCurrentPosition, requestPermissions } from "@tauri-apps/plugin-geolocation";
import { isNative } from "./bridge";
import { VILLAGES, type Village } from "./villages";

export type Position = { lat: number; lon: number };

// Evaluators outside our areas all land in the same default area, so their phones sync together.
export const DEFAULT_AREA = "MDH";
const NEAR_KM = 30;

export async function currentPosition(): Promise<Position | null> {
  try {
    if (isNative) {
      let permissions = await checkPermissions();
      if (permissions.location === "prompt" || permissions.location === "prompt-with-rationale") permissions = await requestPermissions(["location"]);
      if (permissions.location !== "granted") return null;
      const pos = await getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude };
    }
    if (!navigator.geolocation) return null;
    return await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      ),
    );
  } catch {
    return null;
  }
}

function km(a: Position, b: Position) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** The nearest work area within 30 km, or null when the phone is elsewhere. */
export function nearestArea(pos: Position): Village | null {
  const [best] = [...VILLAGES].sort((a, b) => km(pos, a) - km(pos, b));
  return best && km(pos, best) <= NEAR_KM ? best : null;
}
