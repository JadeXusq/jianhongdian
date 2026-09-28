import { THEME_IDS, type ThemeId } from "@jhd/shared";
import { currentThemeId } from "./theme";
import { loadImage } from "./platform";

const backs = new Map<ThemeId, HTMLImageElement>();
const felts = new Map<ThemeId, HTMLImageElement>();
const previews = new Map<ThemeId, HTMLImageElement>();
let ready = false;

export async function loadThemeArt(base = "assets"): Promise<boolean> {
  const prefix = `${base}/themes`;
  try {
    await Promise.all(
      THEME_IDS.map(async (id) => {
        const [back, felt, preview] = await Promise.all([
          loadImage(`${prefix}/${id}-back.png`),
          loadImage(`${prefix}/${id}-felt.png`),
          loadImage(`${prefix}/${id}-preview.png`),
        ]);
        backs.set(id, back);
        felts.set(id, felt);
        previews.set(id, preview);
      })
    );
    ready = true;
    return true;
  } catch (e) {
    console.warn("[themeArt] 贴图加载失败，回退程序化", e);
    ready = false;
    return false;
  }
}

export function themeArtReady(): boolean {
  return ready;
}

export function themeBackImg(id?: ThemeId): HTMLImageElement | null {
  return backs.get(id ?? currentThemeId()) ?? null;
}

export function themeFeltImg(id?: ThemeId): HTMLImageElement | null {
  return felts.get(id ?? currentThemeId()) ?? null;
}

export function themePreviewImg(id: ThemeId): HTMLImageElement | null {
  return previews.get(id) ?? null;
}
