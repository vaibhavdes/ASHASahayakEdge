import { createContext, useContext } from "react";

export type Tab = "home" | "households" | "visit" | "search" | "sync";

export type Route =
  | { screen: "addFamily" }
  | { screen: "household"; id: string }
  | { screen: "inspector" }
  | { screen: "alert"; id: string }
  | { screen: "localAlert"; syndromes: string[]; title: string }
  | { screen: "today" }
  | { screen: "reports" }
  | { screen: "guidance"; q?: string }
  | { screen: "visit"; householdId?: string; memberId?: string };

export interface Nav {
  tab: Tab;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  back: () => void;
}

export const NavContext = createContext<Nav>({ tab: "home", setTab: () => {}, push: () => {}, back: () => {} });
export const useNav = () => useContext(NavContext);
