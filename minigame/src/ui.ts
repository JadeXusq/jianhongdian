/**
 * Canvas 界面基础件，视觉对齐 Web 端 styles.css：
 * .screen 径向遮罩 / .panel 渐变面板 + 回纹角 / .title 字距标题 / .btn 按钮 / .seg 选中态。
 * 坐标为屏幕 CSS 像素；按钮每帧重新登记，触摸时按登记区域命中。
 */
import { roundRect } from "./cardRender";
import { UI } from "./theme";
import type { SysInfo } from "./platform";

export const SERIF = `"Songti SC", "STSong", "SimSun", serif`;
export const SANS = `"Helvetica Neue", Arial, sans-serif`;
export const WIN = "#7dcea0";
export const LOSE = "#e57373";
const NO_LINE_START = "，。、；：！？）」』》,.;:!?)";

/** #rrggbb → rgba，用于 Web 端 rgba(243,234,214,0.6) 这类淡色 */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface Hit {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onTap: () => void;
}

export interface BtnSpec {
  label: string;
  onTap: () => void;
  primary?: boolean;
  on?: boolean;
  disabled?: boolean;
  /** .btn.linkish 虚线次要按钮 */
  dashed?: boolean;
  /** 轻微呼吸缩放（继续下一轮） */
  pulse?: boolean;
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  weight?: number;
  font?: string;
  /** 字间距（px），canvas letterSpacing 兼容性差，逐字绘制 */
  track?: number;
}

export interface Rect {
  px: number;
  py: number;
  pw: number;
  ph: number;
}

export class Overlay {
  readonly w: number;
  readonly h: number;
  /** 左右安全区留边（刘海） */
  readonly inset: number;
  hits: Hit[] = [];

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private sys: SysInfo
  ) {
    this.w = sys.windowWidth;
    this.h = sys.windowHeight;
    const l = sys.safeArea?.left ?? 0;
    const r = sys.safeArea ? sys.windowWidth - sys.safeArea.right : 0;
    this.inset = Math.max(0, l, r);
  }

  begin(): void {
    this.hits = [];
    const dpr = this.sys.pixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  hit(x: number, y: number): boolean {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const b = this.hits[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        b.onTap();
        return true;
      }
    }
    return false;
  }

  /** 吞掉整屏点击（弹层下方不透传给牌桌）；传 onDismiss 则点遮罩关闭 */
  blockAll(onDismiss?: () => void): void {
    this.hits.push({
      label: onDismiss ? "遮罩" : "",
      x: 0,
      y: 0,
      w: this.w,
      h: this.h,
      onTap: onDismiss ?? (() => undefined),
    });
  }

  /** .screen：径向渐变全屏遮罩 */
  screenBg(opaque = false): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h * 0.4,
      0,
      this.w / 2,
      this.h * 0.4,
      Math.max(this.w, this.h) * 0.75
    );
    g.addColorStop(0, alpha(UI.felt, opaque ? 1 : 0.94));
    g.addColorStop(1, alpha(UI.ink, opaque ? 1 : 0.97));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /** .panel：上下渐变 + 淡金细边 + 投影 + 左上 / 右下回纹角 */
  panel(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const r = UI.panelRadius;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, UI.panelTop);
    g.addColorStop(1, UI.panelBot);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = UI.goldDim;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = UI.gold;
    ctx.lineWidth = 2;
    const c = 20;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 8 + c);
    ctx.lineTo(x + 8, y + 8);
    ctx.lineTo(x + 8 + c, y + 8);
    ctx.moveTo(x + w - 8 - c, y + h - 8);
    ctx.lineTo(x + w - 8, y + h - 8);
    ctx.lineTo(x + w - 8, y + h - 8 - c);
    ctx.stroke();
    ctx.restore();
  }

  /** 居中面板；面板内空白处点击不关闭 */
  centerPanel(maxW: number, maxH: number): Rect {
    const pw = Math.min(maxW, this.w - this.inset * 2 - 24);
    const ph = Math.min(maxH, this.h - 16);
    const px = (this.w - pw) / 2;
    const py = (this.h - ph) / 2;
    this.panel(px, py, pw, ph);
    this.hits.push({ label: "", x: px, y: py, w: pw, h: ph, onTap: () => undefined });
    return { px, py, pw, ph };
  }

  /** .panel-x 右上角关闭 */
  closeX(r: Rect, onTap: () => void): void {
    const x = r.px + r.pw - 40;
    const y = r.py + 8;
    this.text("×", x + 16, y + 16, { size: 26, color: alpha(UI.cream, 0.7), weight: 400, font: SANS });
    this.hits.push({ label: "×", x, y, w: 32, h: 32, onTap });
  }

  measure(s: string, o: TextOpts = {}): number {
    const ctx = this.ctx;
    ctx.font = `${o.weight ?? 600} ${o.size ?? 15}px ${o.font ?? SERIF}`;
    const track = o.track ?? 0;
    if (!track) return ctx.measureText(s).width;
    const chars = [...s];
    return chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + track * (chars.length - 1);
  }

  text(s: string, x: number, y: number, o: TextOpts = {}): void {
    const ctx = this.ctx;
    ctx.fillStyle = o.color ?? UI.cream;
    ctx.textBaseline = "middle";
    ctx.font = `${o.weight ?? 600} ${o.size ?? 15}px ${o.font ?? SERIF}`;
    const track = o.track ?? 0;
    const align = o.align ?? "center";
    if (!track) {
      ctx.textAlign = align;
      ctx.fillText(s, x, y);
      return;
    }
    const w = this.measure(s, o);
    let cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.textAlign = "left";
    for (const ch of s) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + track;
    }
  }

  /** .title：金色字距标题 + 投影 */
  title(s: string, x: number, y: number, size = 20, align: CanvasTextAlign = "center"): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    this.text(s, x, y, {
      size,
      color: UI.gold,
      weight: 700,
      align,
      track: size >= 30 ? UI.titleTrack * 0.75 : Math.max(3, UI.titleTrack / 2),
    });
    ctx.restore();
  }

  /** .subtitle：淡色小字 */
  subtitle(s: string, x: number, y: number, size = 13, align: CanvasTextAlign = "center"): void {
    this.text(s, x, y, { size, color: alpha(UI.cream, 0.6), track: 1.5, align, weight: 500 });
  }

  /** .btn / .btn.primary / .seg button.on / .btn.linkish */
  button(label: string, x: number, y: number, w: number, h: number, onTap: () => void, o: Omit<BtnSpec, "label" | "onTap"> = {}): void {
    const ctx = this.ctx;
    ctx.save();
    if (o.pulse) {
      const s = 1 + 0.04 * (1 - Math.cos((Date.now() / 1050) * Math.PI * 2));
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(s, s);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    if (o.disabled) ctx.globalAlpha = 0.45;
    const r = UI.ctrlRadius;
    if (o.primary) {
      ctx.save();
      ctx.shadowColor = "rgba(184,53,43,0.4)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      roundRect(ctx, x, y, w, h, r);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "#c8412f");
      g.addColorStop(1, "#97281f");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    } else {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = o.on ? alpha(UI.gold, 0.16) : o.dashed ? "transparent" : "rgba(0,0,0,0.28)";
      ctx.fill();
      ctx.strokeStyle = o.on ? UI.gold : UI.goldDim;
      ctx.lineWidth = 1;
      if (o.dashed) ctx.setLineDash?.([4, 3]);
      ctx.stroke();
      ctx.setLineDash?.([]);
    }
    const size = Math.max(12, Math.min(17, Math.round(h * 0.4)));
    this.text(label, x + w / 2, y + h / 2 + 1, {
      size,
      color: o.primary ? "#fff5e6" : o.on ? UI.gold : o.dashed ? alpha(UI.cream, 0.7) : UI.cream,
      track: size >= 14 ? 2 : 1,
    });
    ctx.restore();
    if (!o.disabled) this.hits.push({ label, x, y, w, h, onTap });
  }

  /** 一行等宽按钮，铺满 x..x+w */
  buttonRow(btns: BtnSpec[], x: number, y: number, w: number, h = 40, gap = 10): void {
    const n = btns.length;
    if (!n) return;
    const bw = (w - gap * (n - 1)) / n;
    btns.forEach((b, i) => this.button(b.label, x + i * (bw + gap), y, bw, h, b.onTap, b));
  }

  /** 按宽度逐字折行；行首避开句读标点（挂在上一行末） */
  wrapLines(s: string, maxW: number, size: number): string[] {
    this.ctx.font = `600 ${size}px ${SERIF}`;
    const out: string[] = [];
    let line = "";
    for (const ch of s) {
      if (line && !NO_LINE_START.includes(ch) && this.ctx.measureText(line + ch).width > maxW) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    if (line) out.push(line);
    return out;
  }

  /**
   * 左对齐段落，按宽度折行；lead 为首行开头的金色小标题（如「配对」）。
   * 返回占用高度。
   */
  paragraph(s: string, x: number, y: number, maxW: number, size = 14, color = UI.cream, lead = "", lineH = size * 1.7): number {
    const lines = this.wrapLines(s, maxW, size);
    lines.forEach((l, i) => {
      const cy = y + i * lineH + lineH / 2;
      if (i === 0 && lead && l.startsWith(lead)) {
        this.text(lead, x, cy, { size, color: UI.gold, align: "left", weight: 700 });
        const lw = this.measure(lead, { size, weight: 700 });
        this.text(l.slice(lead.length), x + lw, cy, { size, color, align: "left" });
      } else this.text(l, x, cy, { size, color, align: "left" });
    });
    return lines.length * lineH;
  }

  circle(x: number, y: number, r: number, fill: string, stroke?: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** 圆角框（座位卡 / 排行行 / 输入框等） */
  box(x: number, y: number, w: number, h: number, o: { r?: number; fill?: string; stroke?: string; dashed?: boolean } = {}): void {
    const ctx = this.ctx;
    roundRect(ctx, x, y, w, h, o.r ?? 10);
    ctx.fillStyle = o.fill ?? "rgba(0,0,0,0.24)";
    ctx.fill();
    ctx.strokeStyle = o.stroke ?? UI.goldDim;
    ctx.lineWidth = 1;
    if (o.dashed) ctx.setLineDash?.([4, 3]);
    ctx.stroke();
    ctx.setLineDash?.([]);
  }

  /** 胶囊（回合提示 / toast / 表情气泡 / 顶栏按钮） */
  pill(text: string, cx: number, cy: number, o: { bg: string; color?: string; border?: string; size?: number; padX?: number; h?: number }): { x: number; y: number; w: number; h: number } {
    const size = o.size ?? 14;
    const w = this.measure(text, { size, track: 1 }) + (o.padX ?? size * 1.3) * 2;
    const h = o.h ?? size * 2.3;
    const x = cx - w / 2;
    const y = cy - h / 2;
    this.box(x, y, w, h, { r: h / 2, fill: o.bg, stroke: o.border ?? "transparent" });
    this.text(text, cx, cy + 1, { size, color: o.color ?? UI.cream, track: 1 });
    return { x, y, w, h };
  }

  /** 顶栏按钮：左上「菜单」胶囊 / 圆形图标；off 为关闭态（淡色 + 删除线，同 .tb-btn.off） */
  chip(label: string, x: number, y: number, onTap: () => void, round = false, off = false): number {
    const h = 34;
    const w = round ? h : this.measure(label, { size: 14 }) + 24;
    this.box(x, y, w, h, { r: h / 2, fill: "rgba(8,24,18,0.6)" });
    const color = off ? alpha(UI.cream, 0.35) : UI.gold;
    this.text(label, x + w / 2, y + h / 2 + 1, { size: round ? 16 : 14, color });
    if (off) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x + w / 2 - 7, y + h / 2, 14, 1.5);
    }
    this.hits.push({ label, x, y, w, h, onTap });
    return w;
  }

  image(img: CanvasImageSource | null, x: number, y: number, w: number, h: number): void {
    if (img) this.ctx.drawImage(img, x, y, w, h);
  }

  clip(x: number, y: number, w: number, h: number, r: number, fn: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    fn();
    ctx.restore();
  }
}
