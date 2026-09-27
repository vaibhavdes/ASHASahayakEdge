// The app shows one language at a time. Hindi is the default; the header toggles it.
export type Lang = "hi" | "en";

let current: Lang = "hi";

export const setLang = (lang: Lang) => {
  current = lang;
};
export const lang = () => current;
export const tr = (hi: string, en: string) => (current === "hi" ? hi : en);
