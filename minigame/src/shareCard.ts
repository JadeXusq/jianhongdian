/**
 * 分享卡片图：在离屏画布上绘制 500×400（5:4）邀请卡 / 战绩卡，导出临时图片路径。
 * 平台不支持导出时返回 undefined（分享时平台改用当前画面截图）。
 */
import { api, type MiniCanvas } from "./platform";
import { UI } from "./theme";
import { LOSE, Overlay, SANS, WIN, alpha } from "./ui";

const W = 500;
const H = 400;
let surface: { canvas: MiniCanvas; o: Overlay } | null = null;

function begin(): Overlay {
  if (!surface) {
    const canvas = api.createCanvas();
    canvas.width = W;
    canvas.height = H;
    const o = new Overlay(canvas.getContext("2d"), {
      windowWidth: W,
      windowHeight: H,
      pixelRatio: 1,
      platform: "",
    });
    surface = { canvas, o };
  }
  surface.o.begin();
  surface.o.screenBg(true);
  return surface.o;
}

function exportImage(): string | undefined {
  try {
    return surface?.canvas.toTempFilePathSync?.({ x: 0, y: 0, width: W, height: H, destWidth: W, destHeight: H });
  } catch (e) {
    console.warn("[share] 卡片导出失败", e);
    return undefined;
  }
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

export function inviteCard(p: { code: string; seated: number; max: number; host: string }): string | undefined {
  const o = begin();
  const r = o.centerPanel(W - 40, H - 40);
  const cx = W / 2;
  o.title("捡红点", cx, r.py + 56, 40);
  o.subtitle("新中式扑克 · 好友房", cx, r.py + 96, 15);
  o.subtitle("房号", cx, r.py + 146, 14);
  o.text(p.code, cx, r.py + 192, { size: 52, color: UI.gold, font: SANS, weight: 700, track: 12 });
  o.text(`${p.host} 邀请你入座 · ${p.seated}/${p.max} 人`, cx, r.py + 250, { size: 17, color: UI.cream });
  o.button("点我直接入座", cx - 110, r.py + r.ph - 76, 220, 48, () => undefined, { primary: true });
  return exportImage();
}

export function resultCard(p: {
  title: string;
  rows: { name: string; total: number; me: boolean }[];
}): string | undefined {
  const o = begin();
  const r = o.centerPanel(W - 40, H - 40);
  const cx = W / 2;
  o.title(p.title, cx, r.py + 44, 26);
  const rowH = 50;
  const x = r.px + 28;
  const w = r.pw - 56;
  let y = r.py + 80;
  p.rows.slice(0, 4).forEach((row, i) => {
    const mid = y + rowH / 2;
    o.box(x, y, w, rowH - 8, {
      r: 10,
      fill: row.me ? alpha(UI.gold, 0.14) : "rgba(0,0,0,0.24)",
      stroke: row.me ? UI.gold : UI.goldDim,
    });
    o.text(String(i + 1), x + 24, mid - 3, { size: 20, weight: 700, color: i === 0 ? "#f0c96a" : UI.gold, font: SANS });
    o.text(row.name, x + 52, mid - 3, { size: 19, align: "left", color: row.me ? UI.gold : UI.cream });
    o.text(signed(row.total), x + w - 18, mid - 3, {
      size: 24,
      weight: 700,
      font: SANS,
      align: "right",
      color: row.total > 0 ? WIN : row.total < 0 ? LOSE : UI.cream,
    });
    y += rowH;
  });
  o.subtitle("捡红点 · 新中式扑克", cx, r.py + r.ph - 26, 13);
  return exportImage();
}
