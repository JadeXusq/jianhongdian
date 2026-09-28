/**
 * 各界面绘制，版式对齐 Web 端（index.html + styles.css 横屏）：
 * 大厅 / 房号输入 / 房间 / 结算 / 当前积分 / 菜单 / 引导 / 规则 / 排行榜 / 表情 / 确认框。
 * 只负责画与登记按钮，状态与动作由 game.ts 传入。
 */
import type { ThemeId } from "@jhd/shared";
import { themePreviewImg } from "./themeArt";
import { UI } from "./theme";
import { LOSE, SANS, WIN, alpha, type BtnSpec, type Overlay, type Rect } from "./ui";

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

function netColor(n: number): string {
  return n > 0 ? WIN : n < 0 ? LOSE : UI.cream;
}

/** 超宽截断为「…」 */
function fit(o: Overlay, s: string, maxW: number, size: number, weight = 600): string {
  if (o.measure(s, { size, weight }) <= maxW) return s;
  let t = s;
  while (t.length > 1 && o.measure(`${t}…`, { size, weight }) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function link(o: Overlay, label: string, cx: number, cy: number, onTap: () => void): void {
  const w = o.measure(label, { size: 14 });
  o.text(label, cx, cy, { size: 14, color: alpha(UI.cream, 0.55) });
  const ctx = o.ctx;
  ctx.fillStyle = alpha(UI.cream, 0.45);
  ctx.fillRect(cx - w / 2, cy + 9, w, 1);
  o.hits.push({ label, x: cx - w / 2 - 8, y: cy - 14, w: w + 16, h: 28, onTap });
}

// ---------- 主题卡片（大厅 / 菜单共用） ----------

export interface ThemeCard {
  id: ThemeId;
  label: string;
  on: boolean;
  onTap: () => void;
}

function themeCardsHeight(w: number): number {
  return ((w - 16) / 3) * 0.625 + 26;
}

function drawThemeCards(o: Overlay, cards: ThemeCard[], x: number, y: number, w: number): number {
  const gap = 8;
  const cw = (w - gap * 2) / 3;
  const th = cw * 0.625;
  const ch = th + 26;
  const r = UI.ctrlRadius;
  cards.forEach((c, i) => {
    const cx = x + i * (cw + gap);
    if (c.on) o.box(cx - 1.5, y - 1.5, cw + 3, ch + 3, { r: r + 1.5, fill: "transparent", stroke: UI.seal });
    o.box(cx, y, cw, ch, { r, fill: c.on ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.32)", stroke: c.on ? UI.seal : UI.goldDim });
    o.clip(cx, y, cw, ch, r, () => o.image(themePreviewImg(c.id), cx, y, cw, th));
    o.ctx.fillStyle = c.on ? alpha(UI.seal, 0.7) : UI.goldDim;
    o.ctx.fillRect(cx, y + th, cw, 1);
    o.text(c.label, cx + cw / 2, y + th + 13, { size: 12, color: c.on ? UI.cream : alpha(UI.cream, 0.85), track: 0.5 });
    o.hits.push({ label: c.label, x: cx, y, w: cw, h: ch, onTap: c.onTap });
  });
  return ch;
}

// ---------- 大厅 ----------

export function drawLobby(
  o: Overlay,
  p: {
    name: string;
    onName: () => void;
    /** 平台昵称授权按钮（微信时其上盖原生透明按钮） */
    nickLabel: string;
    onNick: () => void;
    maxPlayers: number;
    onCount: (n: number) => void;
    themes: ThemeCard[];
    practiceLabel: string;
    onPractice: () => void;
    resume?: BtnSpec;
    onMatch: () => void;
    onCreate: () => void;
    onJoin: () => void;
    onSpectate: () => void;
    onRank: () => void;
    onRules: () => void;
    onAge: () => void;
  }
): void {
  o.screenBg(true);
  const { px, py, pw, ph } = o.centerPanel(760, 400);
  const pad = 20;
  const innerW = pw - pad * 2;
  const leftW = innerW * 0.44;
  const lx = px + pad;
  const rx = lx + leftW + 20;
  const rw = innerW - leftW - 20;

  const rowH = 38;
  const gap = 7;
  const rows = 7;
  let ry = py + (ph - (rows * rowH + (rows - 1) * gap)) / 2;

  // 左栏与右栏顶对齐：标题 / 副标题占前两行，主题卡片对齐第三行（人机练习）
  o.title("捡红点", lx, ry + 20, 32, "left");
  drawAgeBadge(o, lx + o.measure("捡红点", { size: 32, weight: 700, track: UI.titleTrack * 0.75 }) + 14, ry + 8, p.onAge);
  o.subtitle("出手牌凑十吃红分 · 大王最大", lx, ry + rowH + gap + 12, 12, "left");
  const themeY = ry + 2 * (rowH + gap);
  o.text("主题", lx, themeY + 9, { size: 13, color: UI.gold, align: "left" });
  drawThemeCards(o, p.themes, lx, themeY + 26, leftW);
  const labelW = 50;
  const next = () => (ry += rowH + gap);

  o.text("昵称", rx, ry + rowH / 2, { size: 15, color: alpha(UI.cream, 0.7), align: "left" });
  const nickW = 104;
  const inputW = rw - labelW - nickW - 8;
  o.box(rx + labelW, ry, inputW, rowH, { r: 8, fill: "rgba(0,0,0,0.3)" });
  o.text(fit(o, p.name || "请输入昵称", inputW - 24, 15, 500), rx + labelW + 12, ry + rowH / 2, {
    size: 15,
    color: p.name ? UI.cream : alpha(UI.cream, 0.35),
    align: "left",
    weight: 500,
  });
  o.hits.push({ label: "昵称", x: rx + labelW, y: ry, w: inputW, h: rowH, onTap: p.onName });
  o.button(p.nickLabel, rx + rw - nickW, ry, nickW, rowH, p.onNick);
  next();

  o.text("人数", rx, ry + rowH / 2, { size: 15, color: alpha(UI.cream, 0.7), align: "left" });
  o.buttonRow(
    [2, 3, 4].map((n) => ({ label: `${n} 人`, on: n === p.maxPlayers, onTap: () => p.onCount(n) })),
    rx + labelW,
    ry,
    rw - labelW,
    rowH,
    8
  );
  next();

  o.button(p.practiceLabel, rx, ry, rw, rowH, p.onPractice, { primary: true });
  next();
  o.buttonRow(p.resume ? [p.resume, { label: "快速匹配", onTap: p.onMatch }] : [{ label: "快速匹配", onTap: p.onMatch }], rx, ry, rw, rowH);
  next();
  o.buttonRow([{ label: "创建房间", onTap: p.onCreate }, { label: "输房号加入", onTap: p.onJoin }], rx, ry, rw, rowH);
  next();
  o.buttonRow([{ label: "房号观战", onTap: p.onSpectate }, { label: "排行榜", onTap: p.onRank }], rx, ry, rw, rowH);
  next();
  o.button("查看规则", rx, ry, rw, rowH, p.onRules, { dashed: true });
}

// ---------- 房号输入 ----------

export function drawCodePad(
  o: Overlay,
  p: {
    title: string;
    okLabel: string;
    code: string;
    onDigit: (d: string) => void;
    onDel: () => void;
    onClear: () => void;
    onOk: () => void;
    onCancel: () => void;
  }
): void {
  o.screenBg();
  o.blockAll(p.onCancel);
  const { px, py, pw } = o.centerPanel(320, 350);
  const cx = o.w / 2;
  o.title(p.title, cx, py + 34, 22);

  const cell = 36;
  const cgap = 7;
  const cx0 = cx - (cell * 6 + cgap * 5) / 2;
  for (let i = 0; i < 6; i++) {
    const x = cx0 + i * (cell + cgap);
    o.box(x, py + 60, cell, 40, { r: 8, fill: "rgba(0,0,0,0.3)", stroke: i < p.code.length ? UI.gold : UI.goldDim });
    if (p.code[i]) o.text(p.code[i], x + cell / 2, py + 81, { size: 20, color: UI.gold, font: SANS, weight: 700 });
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "清空", "0", "删除"];
  const kgap = 6;
  const kw = (pw - 48 - kgap * 2) / 3;
  const kh = 34;
  keys.forEach((k, i) => {
    const x = px + 24 + (i % 3) * (kw + kgap);
    const y = py + 114 + Math.floor(i / 3) * (kh + kgap);
    const onTap = k === "删除" ? p.onDel : k === "清空" ? p.onClear : () => p.onDigit(k);
    o.button(k, x, y, kw, kh, onTap);
  });
  o.buttonRow(
    [
      { label: "取消", onTap: p.onCancel },
      { label: p.okLabel, primary: true, disabled: p.code.length !== 6, onTap: p.onOk },
    ],
    px + 24,
    py + 114 + 4 * (kh + kgap) + 6,
    pw - 48,
    40
  );
}

// ---------- 房间 ----------

export interface SeatView {
  label: string;
  ai: boolean;
  tag: string;
  mine: boolean;
  empty: boolean;
  act?: { onTap: () => void; disabled?: boolean };
}

export function drawRoom(
  o: Overlay,
  p: { code: string; status: string; seats: SeatView[]; actions: BtnSpec[]; links: BtnSpec[] }
): void {
  o.screenBg();
  o.blockAll();
  const seatH = 40;
  const sgap = 6;
  const statusLines = o.wrapLines(p.status, 400, 12);
  const top = 86 + statusLines.length * 18;
  const { px, py, pw, ph } = o.centerPanel(460, top + p.seats.length * (seatH + sgap) + 98);
  const cx = o.w / 2;
  o.subtitle("房号", cx, py + 22, 12);
  o.text(p.code || "------", cx, py + 52, { size: 34, color: UI.gold, font: SANS, weight: 700, track: 10 });
  statusLines.forEach((l, i) => o.subtitle(l, cx, py + 84 + i * 18, 12));

  const sx = px + 20;
  const sw = pw - 40;
  p.seats.forEach((s, i) => {
    const y = py + top + i * (seatH + sgap);
    const mid = y + seatH / 2;
    o.box(sx, y, sw, seatH, { stroke: s.mine ? UI.gold : UI.goldDim, dashed: s.empty });
    o.circle(sx + 26, mid, 15, s.empty ? "rgba(0,0,0,0.2)" : "#2b5c48", UI.goldDim);
    o.text(s.empty ? "＋" : s.label.slice(0, 1), sx + 26, mid + 1, { size: 15, color: s.empty ? alpha(UI.cream, 0.4) : UI.cream });
    const nameX = sx + 52;
    const name = fit(o, s.label, sw - 170, 15);
    o.text(name, nameX, mid + 1, { size: 15, align: "left", color: s.empty ? alpha(UI.cream, 0.4) : UI.cream });
    if (s.ai) {
      const nx = nameX + o.measure(name, { size: 15 }) + 6;
      o.box(nx, mid - 8, 18, 16, { r: 4, fill: UI.seal, stroke: "transparent" });
      o.text("机", nx + 9, mid + 1, { size: 11, weight: 700, color: "#fff" });
    }
    if (s.tag) o.text(s.tag, sx + sw - 52, mid + 1, { size: 13, color: UI.gold, align: "right" });
    if (s.act) {
      const ax = sx + sw - 40;
      o.ctx.save();
      if (s.act.disabled) o.ctx.globalAlpha = 0.35;
      o.circle(ax + 14, mid, 14, s.act.disabled ? "rgba(0,0,0,0.28)" : alpha(UI.seal, 0.88), UI.goldDim);
      o.text("⇄", ax + 14, mid + 1, { size: 14, color: "#fff5e6", font: SANS });
      o.ctx.restore();
      if (!s.act.disabled) o.hits.push({ label: `座位${i + 1}`, x: ax - 4, y: y + 2, w: 36, h: seatH - 4, onTap: s.act.onTap });
    }
  });

  o.buttonRow(p.actions, px + 20, py + ph - 88, pw - 40, 40);
  const lw = pw / (p.links.length + 1);
  p.links.forEach((l, i) => link(o, l.label, px + lw * (i + 1), py + ph - 26, l.onTap));
}

// ---------- 积分表（结算 / 当前积分共用） ----------

export interface Board {
  cols: { name: string; ai: boolean; me: boolean }[];
  totals: number[];
  rounds: number[][];
  highlightRound?: number;
  live?: number[];
  piles?: { text: string; red: boolean }[][];
}

const LABEL_W = 40;
const HEAD_H = 30;
const TOTAL_H = 34;
const ROUND_H = 26;
const EMPTY_H = 30;
const LIVE_H = 26;
const CHIP_H = 15;

function pileLines(o: Overlay, b: Board, colW: number): number {
  if (!b.piles?.some((x) => x.length)) return 0;
  let max = 1;
  for (const pile of b.piles) {
    let lines = 1;
    let lw = 0;
    for (const c of pile) {
      const w = o.measure(c.text, { size: 10 }) + 8;
      if (lw + w > colW - 6 && lw > 0) {
        lines++;
        lw = 0;
      }
      lw += w + 2;
    }
    max = Math.max(max, lines);
  }
  return Math.min(3, max);
}

function boardLayout(o: Overlay, b: Board, w: number, maxH: number) {
  const colW = (w - LABEL_W) / Math.max(2, b.cols.length);
  const pl = pileLines(o, b, colW);
  const pilesH = pl ? pl * (CHIP_H + 2) + 10 : 0;
  const fixed = HEAD_H + TOTAL_H + (b.live ? LIVE_H : 0) + pilesH;
  const shown = b.rounds.length
    ? Math.max(1, Math.min(b.rounds.length, Math.floor((maxH - fixed) / ROUND_H)))
    : 0;
  const h = fixed + (shown ? shown * ROUND_H : EMPTY_H);
  return { colW, pl, pilesH, shown, h };
}

function drawBoard(o: Overlay, b: Board, x: number, y: number, w: number, maxH: number): number {
  const L = boardLayout(o, b, w, maxH);
  const ctx = o.ctx;
  const n = b.cols.length;
  o.box(x, y, w, L.h, { fill: "rgba(0,0,0,0.22)" });
  o.clip(x, y, w, L.h, 10, () => {
    ctx.fillStyle = alpha(UI.gold, 0.1);
    ctx.fillRect(x, y, w, HEAD_H);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x, y + HEAD_H, w, TOTAL_H);
    const hi = b.highlightRound;
    const first = b.rounds.length - L.shown;
    if (hi && hi - 1 >= first) {
      ctx.fillStyle = alpha(UI.gold, 0.14);
      ctx.fillRect(x, y + HEAD_H + TOTAL_H + (hi - 1 - first) * ROUND_H, w, ROUND_H);
    }
    b.cols.forEach((c, i) => {
      if (!c.me) return;
      ctx.fillStyle = alpha(UI.gold, 0.14);
      ctx.fillRect(x + LABEL_W + i * L.colW, y, L.colW, L.h);
      ctx.fillStyle = UI.gold;
      ctx.fillRect(x + LABEL_W + i * L.colW, y + HEAD_H - 2, L.colW, 2);
    });
  });

  const colX = (i: number) => x + LABEL_W + i * L.colW + L.colW / 2;
  const sep = (yy: number) => {
    ctx.fillStyle = alpha(UI.gold, 0.18);
    ctx.fillRect(x, yy, w, 1);
  };
  ctx.fillStyle = alpha(UI.gold, 0.16);
  ctx.fillRect(x + LABEL_W, y, 1, L.h);

  b.cols.forEach((c, i) => {
    const name = fit(o, c.name, L.colW - (c.ai ? 24 : 8), 12, 700);
    const nw = o.measure(name, { size: 12, weight: 700 });
    const nx = colX(i) - (c.ai ? 8 : 0);
    o.text(name, nx, y + HEAD_H / 2 + 1, { size: 12, weight: 700, color: c.me ? UI.gold : UI.cream });
    if (c.ai) {
      o.box(nx + nw / 2 + 3, y + HEAD_H / 2 - 7, 15, 14, { r: 3, fill: UI.seal, stroke: "transparent" });
      o.text("机", nx + nw / 2 + 10.5, y + HEAD_H / 2 + 1, { size: 10, weight: 700, color: "#fff" });
    }
  });
  let ry = y + HEAD_H;
  sep(ry);
  const label = (s: string, yy: number, hh: number) =>
    o.text(s, x + LABEL_W / 2, yy + hh / 2 + 1, { size: 11, color: alpha(UI.cream, 0.55), weight: 500 });
  label("累计", ry, TOTAL_H);
  b.totals.forEach((v, i) =>
    o.text(signed(v), colX(i), ry + TOTAL_H / 2 + 1, { size: 16, weight: 700, font: SANS, color: netColor(v) })
  );
  ry += TOTAL_H;
  if (!L.shown) {
    sep(ry);
    o.text("暂无轮次记录", x + w / 2, ry + EMPTY_H / 2 + 1, { size: 12, color: alpha(UI.cream, 0.4), weight: 500 });
    ry += EMPTY_H;
  }
  const first = b.rounds.length - L.shown;
  for (let r = first; r < b.rounds.length; r++) {
    sep(ry);
    label(`R${r + 1}`, ry, ROUND_H);
    for (let i = 0; i < n; i++) {
      const v = b.rounds[r][i] ?? 0;
      o.text(signed(v), colX(i), ry + ROUND_H / 2 + 1, { size: 13, font: SANS, color: netColor(v) });
    }
    ry += ROUND_H;
  }
  if (b.live) {
    sep(ry);
    label("本轮", ry, LIVE_H);
    b.live.forEach((v, i) =>
      o.text(String(v), colX(i), ry + LIVE_H / 2 + 1, { size: 12, weight: 500, color: alpha(UI.cream, 0.72) })
    );
    ry += LIVE_H;
  }
  if (L.pl && b.piles) {
    sep(ry);
    label("吃牌", ry, L.pilesH);
    b.piles.forEach((pile, i) => {
      const cx0 = x + LABEL_W + i * L.colW + 4;
      if (!pile.length) {
        o.text("—", colX(i), ry + L.pilesH / 2, { size: 12, color: alpha(UI.cream, 0.35) });
        return;
      }
      let lx = cx0;
      let line = 0;
      for (const c of pile) {
        const cw = o.measure(c.text, { size: 10 }) + 8;
        if (lx + cw > cx0 + L.colW - 6 && lx > cx0) {
          line++;
          lx = cx0;
        }
        if (line >= L.pl) break;
        const cy = ry + 5 + line * (CHIP_H + 2);
        o.box(lx, cy, cw, CHIP_H, {
          r: 4,
          fill: "rgba(0,0,0,0.28)",
          stroke: c.red ? "rgba(229,115,115,0.45)" : "rgba(243,234,214,0.28)",
        });
        o.text(c.text, lx + cw / 2, cy + CHIP_H / 2 + 1, { size: 10, color: c.red ? LOSE : alpha(UI.cream, 0.88), weight: 500 });
        lx += cw + 2;
      }
    });
  }
  return L.h;
}

function drawDots(o: Overlay, n: number, cx: number, y: number): void {
  const count = Math.max(1, n);
  const x0 = cx - ((count - 1) * 12) / 2;
  for (let i = 0; i < count; i++) {
    const on = i === count - 1;
    o.circle(x0 + i * 12, y, 3.5, on ? UI.gold : "transparent", on ? UI.gold : UI.goldDim);
  }
}

export function drawResult(
  o: Overlay,
  p: { title: string; round: number; code?: string; board: Board; buttons: BtnSpec[] }
): void {
  o.screenBg();
  o.blockAll();
  const w = Math.min(520, o.w - o.inset * 2 - 28);
  const top = 12 + 30 + 14 + (p.code ? 18 : 0);
  const bottom = 10 + 40 + 14;
  const L = boardLayout(o, p.board, w - 28, o.h - 16 - top - bottom);
  const r = o.centerPanel(520, top + L.h + bottom);
  const cx = o.w / 2;
  o.title(p.title, cx, r.py + 26, 20);
  let y = r.py + 48;
  drawDots(o, p.round, cx, y);
  y += 8;
  if (p.code) {
    o.subtitle(`房号 ${p.code}`, cx, y + 8, 12);
    y += 18;
  }
  drawBoard(o, p.board, r.px + 14, y, r.pw - 28, L.h);
  o.buttonRow(p.buttons, r.px + 14, r.py + r.ph - 54, r.pw - 28, 40, 8);
}

export function drawScores(
  o: Overlay,
  p: { sub: string; code?: string; board: Board; onClose: () => void }
): void {
  o.screenBg();
  o.blockAll(p.onClose);
  const w = Math.min(520, o.w - o.inset * 2 - 28);
  const top = 12 + 30 + 20 + (p.code ? 18 : 0);
  const L = boardLayout(o, p.board, w - 28, o.h - 16 - top - 16);
  const r = o.centerPanel(520, top + L.h + 16);
  const cx = o.w / 2;
  o.closeX(r, p.onClose);
  o.title("当前积分", cx, r.py + 28, 20);
  let y = r.py + 52;
  o.subtitle(p.sub, cx, y, 12);
  y += 12;
  if (p.code) {
    o.subtitle(`房号 ${p.code}`, cx, y + 8, 12);
    y += 18;
  }
  drawBoard(o, p.board, r.px + 14, y, r.pw - 28, L.h);
}

// ---------- 菜单 ----------

export function drawMenu(
  o: Overlay,
  p: { themes?: ThemeCard[]; rows: BtnSpec[][]; onClose: () => void }
): void {
  o.screenBg();
  o.blockAll(p.onClose);
  const pw = Math.min(340, o.w - o.inset * 2 - 24);
  const cardH = p.themes ? themeCardsHeight(pw - 48) : 0;
  const r = o.centerPanel(340, 74 + (p.themes ? 22 + cardH + 12 : 0) + p.rows.length * 48 + 8);
  o.closeX(r, p.onClose);
  o.title("菜单", o.w / 2, r.py + 38, 22);
  let y = r.py + 64;
  if (p.themes) {
    o.text("主题", r.px + 24, y + 8, { size: 13, color: UI.gold, align: "left" });
    y += 22;
    drawThemeCards(o, p.themes, r.px + 24, y, r.pw - 48);
    y += cardH + 12;
  }
  for (const row of p.rows) {
    o.buttonRow(row, r.px + 24, y, r.pw - 48, 40, 8);
    y += 48;
  }
}

// ---------- 引导 / 规则 ----------

export const GUIDE_ITEMS: { text: string; gold?: boolean }[] = [
  { text: "目标：吃红色分牌，比底分（240÷人数）高就赢。" },
  { text: "大王 30 · 红A 20 · 红9~K 10 · 红2~8 面值", gold: true },
  { text: "配对：A~9 凑成 10；10/J/Q/K 同点；大小王互吃。" },
  { text: "操作：点手牌 → 有目标则吃，无目标再点一次弃牌。" },
  { text: "每回合：出手牌后还会翻一张牌堆，能吃也要吃。" },
  { text: "多轮：首轮随机庄，之后顺时针轮庄；房主可在菜单结算本场。" },
];

export const RULE_LINES = [
  "牌与发牌：54 张含大小王。手牌共 24 张按人数均分（2人12 / 3人8 / 4人6），桌面掀 6 张，其余 24 张为牌堆。",
  "配对：A~9 两张相加为 10；10/J/Q/K 需同点数；大小王互相配对。",
  "流程：出一张手牌 → 能配必吃（多个目标自选）→ 再翻一张牌堆，同样能配必吃 → 换下一家。",
  "计分：大王 30，红 A 各 20，红 9/10/J/Q/K 各 10，红 2~8 按面值，黑牌与小王 0 分，全场共 240 分。",
  "胜负：得分减去底分（240÷人数），正为赢、负为输。",
  "多轮：不限局数，首轮随机庄、之后顺时针轮庄。对局中点「菜单」可查看累计积分；房主可结算本场。",
];

export function drawGuide(o: Overlay, p: { onOk: () => void }): void {
  o.screenBg();
  o.blockAll(p.onOk);
  const size = 14;
  const lineH = size * 1.75;
  const textW = Math.min(440, o.w - o.inset * 2 - 24) - 48 - 22;
  const bodyH = GUIDE_ITEMS.reduce(
    (s, it) => s + o.wrapLines(it.text, textW, it.gold ? 13 : size).length * lineH + 2,
    0
  );
  const r = o.centerPanel(440, 70 + bodyH + 70);
  o.title("怎么玩", o.w / 2, r.py + 32, 22);
  let y = r.py + 56;
  let n = 0;
  for (const it of GUIDE_ITEMS) {
    n++;
    if (it.gold) y += o.paragraph(it.text, r.px + 24, y, textW + 22, 13, UI.gold, "", lineH) + 2;
    else {
      o.text(`${n}.`, r.px + 24, y + lineH / 2, { size, align: "left", color: alpha(UI.cream, 0.9) });
      y += o.paragraph(it.text, r.px + 46, y, textW, size, alpha(UI.cream, 0.9), "", lineH) + 2;
    }
  }
  o.button("知道了，开打", r.px + 24, r.py + r.ph - 58, r.pw - 48, 42, p.onOk, { primary: true });
}

export function drawRules(o: Overlay, p: { onClose: () => void }): void {
  o.screenBg();
  o.blockAll(p.onClose);
  const size = o.h < 380 ? 12 : 13;
  const lineH = size * 1.8;
  const maxW = Math.min(o.w * 0.72, o.w - o.inset * 2 - 24);
  const textW = maxW - 44;
  const bodyH = RULE_LINES.reduce((s, l) => s + o.wrapLines(l, textW, size).length * lineH + 6, 0);
  const r = o.centerPanel(maxW, 64 + bodyH + 64);
  o.closeX(r, p.onClose);
  o.title("玩法规则", o.w / 2, r.py + 30, 22);
  let y = r.py + 54;
  for (const line of RULE_LINES) {
    const lead = line.slice(0, line.indexOf("："));
    y += o.paragraph(line, r.px + 22, y, textW, size, alpha(UI.cream, 0.85), lead, lineH) + 6;
  }
  o.button("明白了", r.px + 22, r.py + r.ph - 54, r.pw - 44, 40, p.onClose, { primary: true });
}

// ---------- 排行榜 ----------

export function drawRank(
  o: Overlay,
  p: {
    rows: { rank: number; name: string; games: number; wins: number; totalNet: number; me: boolean }[];
    loading: boolean;
    onClose: () => void;
  }
): void {
  o.screenBg();
  o.blockAll(p.onClose);
  const rowH = 34;
  const gap = 6;
  const fitRows = Math.max(1, Math.floor((o.h - 16 - 64 - 70) / (rowH + gap)));
  const rows = p.rows.slice(0, fitRows);
  const listH = rows.length ? rows.length * (rowH + gap) - gap : 40;
  const r = o.centerPanel(480, 64 + listH + 70);
  o.closeX(r, p.onClose);
  o.title("累计排行榜", o.w / 2, r.py + 32, 22);
  const x = r.px + 22;
  const w = r.pw - 44;
  let y = r.py + 58;
  if (!rows.length)
    o.text(p.loading ? "加载中…" : "暂无战绩，先去打一局吧", o.w / 2, y + 20, { size: 13, color: alpha(UI.cream, 0.5) });
  rows.forEach((row) => {
    const mid = y + rowH / 2 + 1;
    o.box(x, y, w, rowH, {
      r: 8,
      fill: row.me ? alpha(UI.gold, 0.12) : "rgba(0,0,0,0.24)",
      stroke: row.me ? UI.gold : UI.goldDim,
    });
    o.text(String(row.rank), x + 18, mid, { size: 13, weight: 700, color: row.rank <= 3 ? "#f0c96a" : UI.gold });
    o.text(fit(o, row.name, w - 200, 14), x + 40, mid, { size: 14, align: "left" });
    o.text(`${row.games} 局 · 胜 ${row.wins}`, x + w - 74, mid, {
      size: 12,
      font: SANS,
      weight: 400,
      color: alpha(UI.cream, 0.55),
      align: "right",
    });
    o.text(signed(row.totalNet), x + w - 12, mid, {
      size: 17,
      weight: 700,
      font: SANS,
      align: "right",
      color: row.totalNet > 0 ? "#6fcf97" : row.totalNet < 0 ? LOSE : UI.cream,
    });
    y += rowH + gap;
  });
  o.button("返回", x, r.py + r.ph - 56, w, 42, p.onClose);
}

// ---------- 表情 ----------

export const EMOTES: { id: string; icon: string }[] = [
  { id: "加油", icon: "💪" },
  { id: "好牌", icon: "👏" },
  { id: "厉害", icon: "👍" },
  { id: "等等", icon: "⏳" },
  { id: "哈哈哈", icon: "😄" },
  { id: "谢谢", icon: "🙏" },
  { id: "倒霉", icon: "😅" },
  { id: "再来", icon: "🔥" },
];

export const QUICK_PHRASES = [
  "拜托给口好牌",
  "这波稳了",
  "小心红点",
  "我先弃一手",
  "等等我思考下",
  "打得漂亮",
  "别急，看牌",
  "这牌太闷了",
  "下一轮继续",
  "友谊第一",
];

export function drawEmotes(
  o: Overlay,
  p: { onEmote: (id: string) => void; onPhrase: (text: string) => void; onClose: () => void }
): void {
  o.screenBg();
  o.blockAll(p.onClose);
  const r = o.centerPanel(420, 316);
  o.closeX(r, p.onClose);
  o.title("表情 · 快捷语", o.w / 2, r.py + 28, 18);
  const x = r.px + 16;
  const w = r.pw - 32;
  const ew = (w - 7 * 4) / 8;
  EMOTES.forEach((e, i) => {
    const ex = x + i * (ew + 4);
    o.box(ex, r.py + 50, ew, 38, { r: UI.ctrlRadius, fill: alpha(UI.felt, 0.55) });
    o.text(e.icon, ex + ew / 2, r.py + 62, { size: 16, weight: 400 });
    o.text(e.id, ex + ew / 2, r.py + 80, { size: 9, color: alpha(UI.cream, 0.7), weight: 500 });
    o.hits.push({ label: `${e.icon}${e.id}`, x: ex, y: r.py + 50, w: ew, h: 38, onTap: () => p.onEmote(e.id) });
  });
  o.ctx.fillStyle = alpha(UI.gold, 0.22);
  o.ctx.fillRect(x, r.py + 96, w, 1);
  const cw = (w - 8) / 2;
  QUICK_PHRASES.forEach((t, i) =>
    o.button(t, x + (i % 2) * (cw + 8), r.py + 106 + Math.floor(i / 2) * 40, cw, 32, () => p.onPhrase(t))
  );
}

// ---------- 确认框（对应 Web 的换座 / 结算对局弹窗） ----------

export interface Dialog {
  title: string;
  text: string;
  okLabel: string;
  cancelLabel: string;
  onOk: () => void;
  onCancel: () => void;
}

/** 适龄提示等级：须与 MP 后台「设置 → 基本信息 → 适龄提示」一致 */
export const AGE_RATING = "12+";

const AGE_LINES = [
  `适用年龄：本游戏适合 ${AGE_RATING.replace("+", "")} 周岁及以上用户。`,
  "游戏类型：扑克牌休闲对局，画面为非写实的 2D 牌面，玩法需要一定的思维判断，包含与其他玩家的计分对抗。",
  "社交功能：游戏内仅提供预设表情和快捷语，不提供自由文字或语音交流。",
  "积分说明：游戏积分仅用于娱乐计分，不可兑换、不可交易。",
  "健康提示：请合理安排游戏时间，注意劳逸结合。",
];

/** 适龄标记（大厅 / 隐私页），点击查看说明 */
export function drawAgeBadge(o: Overlay, x: number, y: number, onTap: () => void): number {
  const w = 86;
  const h = 24;
  o.box(x, y, w, h, { r: 6, fill: alpha(UI.gold, 0.12), stroke: UI.gold });
  o.text(AGE_RATING, x + 20, y + h / 2 + 1, { size: 13, weight: 700, color: UI.gold, font: SANS });
  o.text("适龄提示", x + 57, y + h / 2 + 1, { size: 11, color: alpha(UI.cream, 0.8) });
  o.hits.push({ label: "适龄提示", x, y, w, h, onTap });
  return w;
}

export function drawAgeHint(o: Overlay, p: { onClose: () => void }): void {
  o.screenBg();
  o.blockAll(p.onClose);
  const size = o.h < 380 ? 12 : 13;
  const lineH = size * 1.75;
  const maxW = Math.min(560, o.w - o.inset * 2 - 24);
  const textW = maxW - 48;
  const bodyH = AGE_LINES.reduce((s, l) => s + o.wrapLines(l, textW, size).length * lineH + 4, 0);
  const r = o.centerPanel(maxW, 70 + bodyH + 70);
  o.closeX(r, p.onClose);
  o.title(`适龄提示 ${AGE_RATING}`, o.w / 2, r.py + 32, 22);
  let y = r.py + 58;
  for (const line of AGE_LINES) {
    const lead = line.slice(0, line.indexOf("："));
    y += o.paragraph(line, r.px + 24, y, textW, size, alpha(UI.cream, 0.85), lead, lineH) + 4;
  }
  o.button("知道了", r.px + 24, r.py + r.ph - 56, r.pw - 48, 40, p.onClose, { primary: true });
}

const PRIVACY_ITEMS: { title: string; body: string }[] = [
  { title: "收集的信息", body: "经你授权后，我们会获取你的微信昵称、头像，作为游戏内默认昵称，可随时修改。" },
  { title: "使用目的", body: "仅用于在对局、房间与排行榜中展示你的玩家名称，不作其他用途。" },
  { title: "你的权利", body: "可随时在右上角「···」→「设置」中关闭授权，或联系开发者删除信息。" },
  { title: "拒绝的影响", body: "不同意将退出游戏，你可以稍后重新进入再次选择。" },
];

/** 首次进入的隐私协议全屏页（微信自定义隐私弹窗模式） */
export function drawPrivacy(
  o: Overlay,
  p: { contractName: string; onOpen: () => void; onAgree: () => void; onDisagree: () => void; onAge: () => void }
): void {
  o.screenBg(true);
  o.blockAll();
  const r = o.centerPanel(700, o.h);
  const cx = o.w / 2;
  drawAgeBadge(o, r.px + 24, r.py + 18, p.onAge);
  o.title("用户隐私保护提示", cx, r.py + 46, 30);

  // 引导语 + 指引链接（同一行，链接须用 wx.openPrivacyContract 打开）
  const lead = "欢迎来到捡红点。开始游戏前，请仔细阅读并同意";
  const leadW = o.measure(lead, { size: 13, weight: 500 });
  const linkW = o.measure(p.contractName, { size: 13, weight: 700 });
  const lx = cx - (leadW + linkW) / 2;
  const ly = r.py + 84;
  o.text(lead, lx, ly, { size: 13, weight: 500, color: alpha(UI.cream, 0.7), align: "left" });
  o.text(p.contractName, lx + leadW, ly, { size: 13, weight: 700, color: UI.gold, align: "left" });
  o.ctx.fillStyle = alpha(UI.gold, 0.6);
  o.ctx.fillRect(lx + leadW, ly + 10, linkW, 1);
  o.hits.push({ label: "查看隐私指引", x: lx + leadW - 4, y: ly - 14, w: linkW + 8, h: 28, onTap: p.onOpen });

  // 2×2 信息卡
  const gx = r.px + 32;
  const gw = r.pw - 64;
  const gap = 12;
  const cw = (gw - gap) / 2;
  const ch = 70;
  const gy = r.py + 108;
  PRIVACY_ITEMS.forEach((it, i) => {
    const x = gx + (i % 2) * (cw + gap);
    const y = gy + Math.floor(i / 2) * (ch + gap);
    o.box(x, y, cw, ch, { r: 10, fill: "rgba(0,0,0,0.22)" });
    o.circle(x + 16, y + 18, 3, UI.gold);
    o.text(it.title, x + 26, y + 18, { size: 14, weight: 700, color: UI.gold, align: "left" });
    o.paragraph(it.body, x + 14, y + 30, cw - 28, 12, alpha(UI.cream, 0.82), "", 18);
  });

  const bh = 42;
  const bw = Math.min(360, r.pw - 80);
  const by = r.py + r.ph - bh - 30;
  o.buttonRow(
    [
      { label: "不同意并退出", onTap: p.onDisagree },
      { label: "同意并继续", primary: true, onTap: p.onAgree },
    ],
    cx - bw / 2,
    by,
    bw,
    bh,
    14
  );
  o.subtitle("点击「同意并继续」即表示你已阅读并同意上述指引", cx, by + bh + 16, 11);
}

/** 首次进入无昵称时的引导（「用微信昵称」按钮上盖原生授权按钮） */
export function drawNickPrompt(
  o: Overlay,
  p: { nickLabel: string; onNick: () => void; onManual: () => void; onLater: () => void }
): void {
  o.screenBg();
  o.blockAll(p.onLater);
  const r: Rect = o.centerPanel(300, 290);
  o.title("设置昵称", o.w / 2, r.py + 40, 24);
  o.subtitle("对局中其他玩家会看到你的昵称", o.w / 2, r.py + 76, 13);
  const x = r.px + 28;
  const w = r.pw - 56;
  o.button(p.nickLabel, x, r.py + 104, w, 42, p.onNick, { primary: true });
  o.button("手动输入", x, r.py + 156, w, 42, p.onManual);
  o.button("稍后再说", x, r.py + 208, w, 42, p.onLater, { dashed: true });
}

export function drawDialog(o: Overlay, d: Dialog): void {
  o.screenBg();
  o.blockAll(d.onCancel);
  const lines = o.wrapLines(d.text, 240, 13);
  const r: Rect = o.centerPanel(300, 96 + lines.length * 20 + 110);
  o.title(d.title, o.w / 2, r.py + 40, 24);
  lines.forEach((l, i) => o.subtitle(l, o.w / 2, r.py + 74 + i * 20, 13));
  const x = r.px + 28;
  const w = r.pw - 56;
  o.button(d.cancelLabel, x, r.py + r.ph - 112, w, 42, d.onCancel);
  o.button(d.okLabel, x, r.py + r.ph - 60, w, 42, d.onOk, { primary: true });
}
