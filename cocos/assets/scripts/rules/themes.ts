// ⚠️ 自动生成，请勿直接修改：源文件在 shared/src/，改完执行 node tools/syncCocosLib.mjs
/** 房间桌面主题（Web / Cocos / 服务端白名单同源） */

export type ThemeId = "jade" | "jilan" | "mohong";

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

export const THEME_IDS: ThemeId[] = ["jade", "jilan", "mohong"];
export const DEFAULT_THEME_ID: ThemeId = "jade";

/** 旧版「动漫风」id，读取存档/房间时迁到霁蓝 */
const THEME_ALIASES: Record<string, ThemeId> = { anime: "jilan" };

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
  jilan: {
    id: "jilan",
    name: "霁蓝",
    canvas: {
      feltInner: "#1a3d5c",
      feltOuter: "#0a1628",
      gold: "#d4c49a",
      goldDim: "#7a6b45",
      seal: "#c23b3b",
      cream: "#f2efe6",
      ink: "#1a2430",
      cardFace: "#f7f5ef",
      cardBack: "#163452",
      shadow: "rgba(6,14,28,0.5)",
      dim: "rgba(8,16,28,0.58)",
      panelBg: "rgba(10,24,42,0.8)",
    },
    css: {
      gold: "#d4c49a",
      goldDim: "rgba(212, 196, 154, 0.38)",
      seal: "#c23b3b",
      cream: "#f2efe6",
      felt: "#12263c",
      ink: "#081018",
    },
  },
  mohong: {
    id: "mohong",
    name: "墨红",
    canvas: {
      feltInner: "#1a1514",
      feltOuter: "#0a0808",
      gold: "#c4a36a",
      goldDim: "#7a6238",
      seal: "#b8352b",
      cream: "#efe2c9",
      ink: "#1c1412",
      cardFace: "#f6efe3",
      cardBack: "#1a1514",
      shadow: "rgba(0,0,0,0.55)",
      dim: "rgba(10,8,8,0.58)",
      panelBg: "rgba(14,12,11,0.82)",
    },
    css: {
      gold: "#c4a36a",
      goldDim: "rgba(196, 163, 106, 0.38)",
      seal: "#b8352b",
      cream: "#efe2c9",
      felt: "#12100f",
      ink: "#080606",
    },
  },
};

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as string[]).includes(v);
}

/** 是否可接受的主题入参（含历史别名） */
export function isThemeInput(v: unknown): boolean {
  return (
    isThemeId(v) || (typeof v === "string" && v in THEME_ALIASES)
  );
}

export function resolveThemeId(v: unknown): ThemeId {
  if (typeof v !== "string") return DEFAULT_THEME_ID;
  if (isThemeId(v)) return v;
  return THEME_ALIASES[v] ?? DEFAULT_THEME_ID;
}
