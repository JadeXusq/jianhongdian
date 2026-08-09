import { resources, SpriteFrame } from "cc";
import { THEME_IDS, type ThemeId } from "./rules/themes";
import { currentThemeId } from "./Theme";

const backs = new Map<ThemeId, SpriteFrame>();
const felts = new Map<ThemeId, SpriteFrame>();
const previews = new Map<ThemeId, SpriteFrame>();
let ready = false;

function loadRes(path: string): Promise<SpriteFrame | null> {
  return new Promise((resolve) => {
    resources.load(`${path}/spriteFrame`, SpriteFrame, (err, sf) => {
      if (!err && sf) {
        resolve(sf);
        return;
      }
      resources.load(path, SpriteFrame, (err2, sf2) => {
        resolve(!err2 && sf2 ? sf2 : null);
      });
    });
  });
}

export async function loadThemeArt(): Promise<boolean> {
  if (ready) return true;
  try {
    for (const id of THEME_IDS) {
      const [back, felt, preview] = await Promise.all([
        loadRes(`themes/${id}-back`),
        loadRes(`themes/${id}-felt`),
        loadRes(`themes/${id}-preview`),
      ]);
      if (!back || !felt) throw new Error(`missing ${id}`);
      backs.set(id, back);
      felts.set(id, felt);
      if (preview) previews.set(id, preview);
    }
    ready = true;
    return true;
  } catch (e) {
    console.warn("[themeArt] 贴图加载失败", e);
    ready = false;
    return false;
  }
}

export function themeArtReady(): boolean {
  return ready;
}

export function themeBackSf(id?: ThemeId): SpriteFrame | null {
  return backs.get(id ?? currentThemeId()) ?? null;
}

export function themeFeltSf(id?: ThemeId): SpriteFrame | null {
  return felts.get(id ?? currentThemeId()) ?? null;
}

export function themePreviewSf(id: ThemeId): SpriteFrame | null {
  return previews.get(id) ?? null;
}
