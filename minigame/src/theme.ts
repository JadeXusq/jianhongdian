/**
 * 运行时主题：canvas 色板 C + 界面色板 UI（对应 Web 端 CSS 变量）。
 * 色值源头在 @jhd/shared themes。
 */
import {
  DEFAULT_THEME_ID,
  THEMES,
  resolveThemeId,
  type ThemeId,
  type ThemeCanvas,
} from "@jhd/shared";
import { storage } from "./platform";

export type { ThemeId };

export const C: ThemeCanvas = { ...THEMES[DEFAULT_THEME_ID].canvas };

export const UI = {
  gold: "",
  goldDim: "",
  seal: "",
  cream: "",
  felt: "",
  ink: "",
  panelTop: "",
  panelBot: "",
  panelRadius: 14,
  ctrlRadius: 9,
  titleTrack: 8,
};

export const CARD_RATIO = 1.4;

let currentId: ThemeId = DEFAULT_THEME_ID;

export function currentThemeId(): ThemeId {
  return currentId;
}

function syncUi(tid: ThemeId): void {
  const t = THEMES[tid];
  Object.assign(UI, t.css, {
    panelTop: t.canvas.feltInner,
    panelBot: t.canvas.feltOuter,
    panelRadius: tid === "jilan" ? 16 : tid === "mohong" ? 10 : 14,
    ctrlRadius: tid === "jilan" ? 11 : tid === "mohong" ? 7 : 9,
    titleTrack: tid === "jilan" ? 5 : tid === "mohong" ? 6 : 8,
  });
}
syncUi(DEFAULT_THEME_ID);

export function applyTheme(id: unknown): ThemeId {
  const tid = resolveThemeId(id);
  currentId = tid;
  Object.assign(C, THEMES[tid].canvas);
  syncUi(tid);
  storage.set("jhd.theme", tid);
  return tid;
}

export function loadSavedTheme(): ThemeId {
  return resolveThemeId(storage.get("jhd.theme"));
}
