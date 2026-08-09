/**
 * 运行时主题（与 Web / shared themes 对齐）
 */
import { Color } from "cc";
import {
  DEFAULT_THEME_ID,
  THEMES,
  resolveThemeId,
  type ThemeId,
} from "./rules";

export type { ThemeId };

function hexColor(hex: string, a = 255): Color {
  const h = hex.replace("#", "");
  if (h.length === 8) {
    return new Color(
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      parseInt(h.slice(6, 8), 16)
    );
  }
  if (hex.startsWith("rgba")) {
    const m = hex.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      return new Color(
        Number(m[0]),
        Number(m[1]),
        Number(m[2]),
        Math.round(Number(m[3] ?? 1) * 255)
      );
    }
  }
  return new Color(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    a
  );
}

function paint(c: Color, hex: string): void {
  const n = hexColor(hex);
  c.set(n.r, n.g, n.b, n.a);
}

export const C = {
  feltInner: hexColor(THEMES.jade.canvas.feltInner),
  feltOuter: hexColor(THEMES.jade.canvas.feltOuter),
  gold: hexColor(THEMES.jade.canvas.gold),
  goldDim: hexColor(THEMES.jade.canvas.goldDim),
  seal: hexColor(THEMES.jade.canvas.seal),
  cream: hexColor(THEMES.jade.canvas.cream),
  ink: hexColor(THEMES.jade.canvas.ink),
  cardFace: hexColor(THEMES.jade.canvas.cardFace),
  cardBack: hexColor(THEMES.jade.canvas.cardBack),
  panelBg: hexColor(THEMES.jade.canvas.panelBg),
  dim: hexColor(THEMES.jade.canvas.dim),
};

export const DESIGN = { width: 1280, height: 720 };
export const CARD_RATIO = 1.4;
export const HAND_W = 96;
export const TABLE_CARD_W = 74;

let currentId: ThemeId = DEFAULT_THEME_ID;

export function currentThemeId(): ThemeId {
  return currentId;
}

export function applyTheme(id: unknown): ThemeId {
  const tid = resolveThemeId(id);
  currentId = tid;
  const t = THEMES[tid].canvas;
  paint(C.feltInner, t.feltInner);
  paint(C.feltOuter, t.feltOuter);
  paint(C.gold, t.gold);
  paint(C.goldDim, t.goldDim);
  paint(C.seal, t.seal);
  paint(C.cream, t.cream);
  paint(C.ink, t.ink);
  paint(C.cardFace, t.cardFace);
  paint(C.cardBack, t.cardBack);
  paint(C.panelBg, t.panelBg);
  paint(C.dim, t.dim);
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
