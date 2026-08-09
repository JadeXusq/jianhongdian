import { THEME_IDS, type ThemeId } from "@jhd/shared";
import { currentThemeId } from "./theme";

const backs = new Map<ThemeId, HTMLImageElement>();
const felts = new Map<ThemeId, HTMLImageElement>();
let ready = false;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

export async function loadThemeArt(base = ""): Promise<boolean> {
  const prefix = `${base}/themes`;
  try {
    await Promise.all(
      THEME_IDS.map(async (id) => {
        const [back, felt] = await Promise.all([
          loadImage(`${prefix}/${id}-back.png`),
          loadImage(`${prefix}/${id}-felt.png`),
        ]);
        backs.set(id, back);
        felts.set(id, felt);
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

export function themePreviewUrl(id: ThemeId, base = ""): string {
  return `${base}/themes/${id}-preview.png`;
}
