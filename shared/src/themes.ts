/** 房间桌面主题（Web / Cocos / 服务端白名单同源） */

export type ThemeId = "jade" | "anime" | "night";

export interface ThemeCanvas {
  feltInner: string;
  feltOuter: string;
  gold: string;
  goldDim: string;
  seal: string;
  cream: string;
  ink: string;
  cardFace: string;
  cardBack: string;
  shadow: string;
  dim: string;
  panelBg: string;
}

export interface ThemeCss {
  gold: string;
  goldDim: string;
  seal: string;
  cream: string;
  felt: string;
  ink: string;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  canvas: ThemeCanvas;
  css: ThemeCss;
}

export const THEME_IDS: ThemeId[] = ["jade", "anime", "night"];
export const DEFAULT_THEME_ID: ThemeId = "jade";

export const THEMES: Record<ThemeId, ThemeDef> = {
  jade: {
    id: "jade",
    name: "青绿金",
    canvas: {
      feltInner: "#1c4c3b",
      feltOuter: "#0d2a20",
      gold: "#c9a961",
      goldDim: "#7d6739",
      seal: "#b8352b",
      cream: "#f3ead6",
      ink: "#26262a",
      cardFace: "#f7f1e2",
      cardBack: "#6d2420",
      shadow: "rgba(0,0,0,0.45)",
      dim: "rgba(6,20,15,0.55)",
      panelBg: "rgba(8,26,20,0.72)",
    },
    css: {
      gold: "#c9a961",
      goldDim: "rgba(201, 169, 97, 0.35)",
      seal: "#b8352b",
      cream: "#f3ead6",
      felt: "#123a2e",
      ink: "#0b1f18",
    },
  },
  anime: {
    id: "anime",
    name: "动漫风",
    canvas: {
      feltInner: "#3d2a6d",
      feltOuter: "#1a1038",
      gold: "#ff8dc7",
      goldDim: "#c45a9a",
      seal: "#ff4d6d",
      cream: "#fff5fb",
      ink: "#2a1a3a",
      cardFace: "#fffafc",
      cardBack: "#6b3fa0",
      shadow: "rgba(40,10,60,0.45)",
      dim: "rgba(30,15,50,0.55)",
      panelBg: "rgba(28,16,56,0.78)",
    },
    css: {
      gold: "#ff8dc7",
      goldDim: "rgba(255, 141, 199, 0.4)",
      seal: "#ff4d6d",
      cream: "#fff5fb",
      felt: "#2b1b52",
      ink: "#120a24",
    },
  },
  night: {
    id: "night",
    name: "夜蓝",
    canvas: {
      feltInner: "#163a5f",
      feltOuter: "#0a1a2e",
      gold: "#5ec8ff",
      goldDim: "#3a7ea8",
      seal: "#ff6b4a",
      cream: "#e8f4ff",
      ink: "#0e1a28",
      cardFace: "#f2f8ff",
      cardBack: "#1e4d7b",
      shadow: "rgba(0,20,40,0.5)",
      dim: "rgba(6,18,32,0.55)",
      panelBg: "rgba(8,24,42,0.78)",
    },
    css: {
      gold: "#5ec8ff",
      goldDim: "rgba(94, 200, 255, 0.4)",
      seal: "#ff6b4a",
      cream: "#e8f4ff",
      felt: "#0f2740",
      ink: "#061018",
    },
  },
};

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as string[]).includes(v);
}

export function resolveThemeId(v: unknown): ThemeId {
  return isThemeId(v) ? v : DEFAULT_THEME_ID;
}
