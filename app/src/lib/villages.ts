import villages from "../../../data/out/villages.json";

export interface Village {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export const VILLAGES = villages as Village[];
export const villageName = (code: string) => VILLAGES.find((v) => v.code === code)?.name ?? code;
