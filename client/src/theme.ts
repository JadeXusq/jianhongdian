/**
 * 运行时主题：canvas 色板 C + CSS 变量。
 * 色值源头在 @jhd/shared themes。
 */
import {
  DEFAULT_THEME_ID,
  THEMES,
  resolveThemeId,
  type ThemeId,
  type ThemeCanvas,
} from "@jhd/shared";

export type { ThemeId };

export const C: ThemeCanvas = { ...THEMES[DEFAULT_THEME_ID].canvas };

export const CARD_RATIO = 1.4;

let currentId: ThemeId = DEFAULT_THEME_ID;

export function currentThemeId(): ThemeId {
  return currentId;
}

export function applyTheme(id: unknown): ThemeId {
  const tid = resolveThemeId(id);
  currentId = tid;
  const t = THEMES[tid];
  Object.assign(C, t.canvas);
  const root = document.documentElement;
  root.dataset.theme = tid;
  root.style.setProperty("--gold", t.css.gold);
  root.style.setProperty("--gold-dim", t.css.goldDim);
  root.style.setProperty("--seal", t.css.seal);
  root.style.setProperty("--cream", t.css.cream);
  root.style.setProperty("--felt", t.css.felt);
  root.style.setProperty("--ink", t.css.ink);
  try {
    localStorage.setItem("jhd.theme", tid);
  } catch {
    /* ignore */
  }
  return tid;
}

export function loadSavedTheme(): ThemeId {
  try {
    return resolveThemeId(localStorage.getItem("jhd.theme"));
  } catch {
    return DEFAULT_THEME_ID;
  }
}
