/**
 * 牌面绘制：优先使用预烘焙图集（位图，跨设备一致），未加载时回退程序化绘制。
 */
import {
  cardFromId,
  cardScore,
  isJoker,
  isRed,
  RED_JOKER_ID,
} from "@jhd/shared";
import { C, CARD_RATIO, currentThemeId } from "./theme";
import { themeBackImg } from "./themeArt";

const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const SUIT_SYM: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export interface CardStyle {
  faceUp?: boolean;
  dim?: boolean;
  highlight?: boolean;
  selected?: boolean;
  /** 弃牌二次确认态：红色边框 */
  discard?: boolean;
  /** 可选目标脉冲高亮用时间戳（秒） */
  pulse?: number;
  /** 水平缩放（翻牌用，绕牌心） */
  scaleX?: number;
}

interface AtlasMeta {
  cw: number;
  ch: number;
  cols: number;
  backIndex: number;
}

let atlasImg: HTMLImageElement | null = null;
let atlasMeta: AtlasMeta | null = null;

export function cardAtlasReady(): boolean {
  return !!(atlasImg && atlasMeta);
}

/** 加载位图图集；失败时静默回退程序化绘制 */
export async function loadCardAtlas(
  base = ""
): Promise<boolean> {
  try {
    const [img, meta] = await Promise.all([
      loadImage(`${base}/card-atlas.png`),
      fetch(`${base}/card-atlas.json`).then((r) => {
        if (!r.ok) throw new Error("atlas json");
        return r.json() as Promise<AtlasMeta>;
      }),
    ]);
    atlasImg = img;
    atlasMeta = meta;
    return true;
  } catch (e) {
    console.warn("[card] 图集加载失败，回退程序化绘制", e);
    atlasImg = null;
    atlasMeta = null;
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCard(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  w: number,
  style: CardStyle = {}
): void {
  const h = w * CARD_RATIO;
  const r = w * 0.09;
  const faceUp = style.faceUp !== false;
  const sx = Math.max(0.02, Math.abs(style.scaleX ?? 1));
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  if (sx !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(sx, 1);
    ctx.translate(-cx, -cy);
  }

  ctx.save();
  ctx.shadowColor = C.shadow;
  ctx.shadowBlur = w * 0.14;
  ctx.shadowOffsetY = w * 0.05;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = faceUp ? C.cardFace : C.cardBack;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (!faceUp) {
    const back = themeBackImg(currentThemeId());
    if (back) ctx.drawImage(back, x, y, w, h);
    else if (atlasImg && atlasMeta)
      blitAtlas(ctx, atlasMeta.backIndex, x, y, w, h);
    else drawBack(ctx, x, y, w, h);
  } else if (atlasImg && atlasMeta) {
    blitAtlas(ctx, id, x, y, w, h);
  } else {
    drawFace(ctx, id, x, y, w, h);
  }
  if (style.dim) {
    ctx.fillStyle = C.dim;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  if (style.discard) {
    ctx.strokeStyle = C.seal;
    ctx.lineWidth = Math.max(3, w * 0.055);
    ctx.shadowColor = C.seal;
    ctx.shadowBlur = w * 0.25;
  } else if (style.selected) {
    ctx.strokeStyle = C.seal;
    ctx.lineWidth = Math.max(2, w * 0.045);
  } else if (style.highlight) {
    const pulse =
      style.pulse !== undefined
        ? 0.55 + 0.45 * Math.sin(style.pulse * Math.PI * 2)
        : 1;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = Math.max(2, w * 0.045);
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = w * 0.3 * pulse;
    ctx.globalAlpha = 0.65 + 0.35 * pulse;
  } else {
    ctx.strokeStyle = faceUp ? "rgba(125,103,57,0.5)" : C.goldDim;
    ctx.lineWidth = Math.max(1, w * 0.018);
  }
  ctx.stroke();
  ctx.restore();

  if (style.discard) {
    ctx.save();
    ctx.fillStyle = "rgba(184,53,43,0.78)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${w * 0.28}px "Songti SC", "STSong", serif`;
    ctx.fillText("弃", x + w / 2, y + h / 2);
    ctx.restore();
  }
  ctx.restore();
}

function blitAtlas(
  ctx: CanvasRenderingContext2D,
  index: number,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const m = atlasMeta!;
  const col = index % m.cols;
  const row = Math.floor(index / m.cols);
  ctx.drawImage(
    atlasImg!,
    col * m.cw,
    row * m.ch,
    m.cw,
    m.ch,
    x,
    y,
    w,
    h
  );
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const red = isRed(id);
  const color = red ? C.seal : C.ink;

  if (isJoker(id)) {
    ctx.fillStyle = id === RED_JOKER_ID ? C.seal : C.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${w * 0.5}px "Songti SC", "STSong", serif`;
    ctx.fillText("王", x + w / 2, y + h * 0.44);
    ctx.font = `${w * 0.17}px "Songti SC", "STSong", serif`;
    ctx.fillText(id === RED_JOKER_ID ? "大" : "小", x + w / 2, y + h * 0.72);
  } else {
    const { suit, rank } = cardFromId(id);
    const sym = SUIT_SYM[suit as "S" | "H" | "D" | "C"];
    const label = RANKS[rank - 1];
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${w * 0.26}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(label, x + w * 0.19, y + h * 0.14);
    ctx.font = `${w * 0.2}px serif`;
    ctx.fillText(sym, x + w * 0.19, y + h * 0.27);
    ctx.globalAlpha = 0.9;
    ctx.font = `${w * 0.52}px serif`;
    ctx.fillText(sym, x + w * 0.56, y + h * 0.6);
    ctx.globalAlpha = 1;
  }

  const score = cardScore(id);
  if (score > 0) {
    const cx = x + w * 0.19;
    const cy = y + h * 0.87;
    const rad = w * 0.14;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = C.seal;
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.015);
    ctx.strokeStyle = C.gold;
    ctx.stroke();
    ctx.fillStyle = C.cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${w * 0.16}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(String(score), cx, cy + w * 0.005);
  }
}

function drawBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const tid = currentThemeId();
  ctx.strokeStyle =
    tid === "anime"
      ? "rgba(255,141,199,0.4)"
      : tid === "night"
      ? "rgba(94,200,255,0.35)"
      : "rgba(201,169,97,0.35)";
  ctx.lineWidth = Math.max(0.5, w * 0.012);
  const step = w * 0.18;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  if (tid === "night") {
    ctx.fillStyle = "rgba(180,230,255,0.55)";
    for (let i = 0; i < 8; i++) {
      const px = x + w * (0.2 + ((i * 37) % 60) / 100);
      const py = y + h * (0.15 + ((i * 53) % 70) / 100);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1, w * 0.015), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const s = w * 0.42;
  ctx.fillStyle =
    tid === "anime"
      ? "rgba(255,141,199,0.9)"
      : tid === "night"
      ? "rgba(94,200,255,0.85)"
      : "rgba(201,169,97,0.9)";
  roundRect(ctx, x + (w - s) / 2, y + (h - s) / 2, s, s, s * 0.12);
  ctx.fill();
  ctx.fillStyle = C.cardBack;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${s * 0.62}px "Songti SC", "STSong", serif`;
  ctx.fillText("红", x + w / 2, y + h / 2 + s * 0.02);
}
