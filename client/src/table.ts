/**
 * 牌桌视图：布局 / 绘制 / 命中测试 / 动画
 *
 * 坐标系：逻辑高度固定 720，逻辑宽度随屏幕比例伸缩（限制在 W_MIN~W_MAX），
 * 以便从 4:3 平板到 21:9 长屏都尽量铺满、不留黑边。
 * 竖屏时整幅画面软件旋转 90°，保证永远是横屏玩法。
 */
import { cardScore } from "@jhd/shared";
import type { GameEvent } from "@jhd/shared";
import {
  DISCARD_HOLD_S,
  FLY_TARGET_HOLD_S,
  MATCH_HOLD_S,
  FLY_PILE_HOLD_S,
} from "@jhd/shared";
import { drawCard, roundRect } from "./cardRender";
import { shouldRotate, onOrientationChange } from "./layout";
import { C, CARD_RATIO } from "./theme";

const H = 720;
/** 逻辑宽度下限（近方屏如 4:3 平板）与上限（超长屏）*/
const W_MIN = 1040;
const W_MAX = 1700;
const HAND_W = 96;
const TABLE_CARD_W = 74;
// 牌堆放在左上角：左/右/上三个方向均可能有对手面板，此处不会重叠
const DECK = { x: 118, y: 128, w: 66 };

interface Pt {
  x: number;
  y: number;
}
interface Slot extends Pt {
  w: number;
}

interface Fly {
  id: number;
  from: Pt;
  to: Pt;
  w: number;
  t: number;
  dur: number;
  faceUp: boolean;
}

interface Popup {
  text: string;
  at: Pt;
  t: number;
}

/** 一个动画步骤，按顺序播放，让玩家看清每次吃牌 */
interface Step {
  flies: Fly[];
  popups: Popup[];
  /** 播放期间隐藏这些牌的静态位置，避免与飞行的牌重影 */
  hide: number[];
  /** 飞行结束后的停顿，给眼睛一点反应时间 */
  hold: number;
}

export interface TableCallbacks {
  onPickHand(cardId: number): void;
  onPickTable(cardId: number): void;
}

export class TableView {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  /** 居中留边（在“视觉横屏”坐标系下）*/
  private pad: Pt = { x: 0, y: 0 };
  /** 当前逻辑宽度，随屏幕比例变化 */
  private w = 1280;
  /** 是否软件旋转（竖屏手机）*/
  private rotated = false;

  private handSlots = new Map<number, Slot>();
  private tableSlots = new Map<number, Slot>();
  private pilePos = new Map<number, Pt>(); // seat → 得分堆位置

  private steps: Step[] = [];
  private current: Step | null = null;
  private hidden = new Set<number>();

  /** 由外部每帧提供的渲染数据 */
  state: any = null;
  hand: number[] = [];
  mySeat = 0;
  selected = -1;
  targets: number[] = [];

  constructor(private canvas: HTMLCanvasElement, private cb: TableCallbacks) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    onOrientationChange(() => this.resize());
    canvas.addEventListener("pointerdown", (e) => this.onPointer(e));
  }

  /** 桌面明牌区：左右给对手面板和牌堆留位，其余横向铺满 */
  private get area() {
    return { x: 236, y: 148, w: this.w - 472, h: 300 };
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.rotated = shouldRotate();
    // 旋转后，“视觉上的横屏尺寸”是屏幕宽高互换
    const vw = this.rotated ? ch : cw;
    const vh = this.rotated ? cw : ch;

    // 优先按高度贴合并用逻辑宽度吸收比例差异；超出限制时才留黑边
    let w = (vw / vh) * H;
    if (w < W_MIN) {
      w = W_MIN;
      this.scale = vw / W_MIN;
    } else {
      if (w > W_MAX) w = W_MAX;
      this.scale = vh / H;
    }
    this.w = w;
    this.pad = {
      x: (vw - w * this.scale) / 2,
      y: (vh - H * this.scale) / 2,
    };
  }

  private onPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    let sx = e.clientX - rect.left;
    let sy = e.clientY - rect.top;
    if (this.rotated) {
      // 渲染时做了 translate(cw,0) + rotate(90°)，这里取其逆变换
      const cw = rect.width;
      [sx, sy] = [sy, cw - sx];
    }
    const x = (sx - this.pad.x) / this.scale;
    const y = (sy - this.pad.y) / this.scale;
    // 手牌在上层，优先命中；同层从右往左（后绘制的在上）
    const hit = (slots: Map<number, Slot>) => {
      const entries = [...slots.entries()].reverse();
      for (const [id, s] of entries)
        if (
          x >= s.x &&
          x <= s.x + s.w &&
          y >= s.y &&
          y <= s.y + s.w * CARD_RATIO
        )
          return id;
      return -1;
    };
    const h = hit(this.handSlots);
    if (h >= 0) return this.cb.onPickHand(h);
    const t = hit(this.tableSlots);
    if (t >= 0) this.cb.onPickTable(t);
  }

  /** 把服务器事件转成动画步骤 */
  pushEvents(events: GameEvent[]): void {
    for (const ev of events) {
      const from =
        ev.type === "FLIP"
          ? { x: DECK.x, y: DECK.y }
          : this.handSlots.get(ev.card) ?? this.panelPos(ev.player);
      const pile = this.pilePos.get(ev.player) ?? { x: this.w / 2, y: H / 2 };

      if (ev.target === undefined) {
        // 弃牌：从来源飞到桌面槽位（槽位在下一帧才确定，先飞向桌面中心附近）
        const to = this.tableSlots.get(ev.card) ?? {
          x: this.area.x + this.area.w / 2,
          y: this.area.y,
        };
        this.steps.push({
          flies: [
            {
              id: ev.card,
              from,
              to,
              w: TABLE_CARD_W,
              t: 0,
              dur: 0.34,
              faceUp: true,
            },
          ],
          popups: [],
          hide: [ev.card],
          hold: DISCARD_HOLD_S,
        });
        continue;
      }

      // 吃牌：出的牌飞向目标位置，然后两张牌居中展示 5 秒（match），再飞入得分堆
      const targetSlot = this.tableSlots.get(ev.target) ?? {
        x: this.w / 2,
        y: this.area.y + 100,
      };
      const gain = cardScore(ev.card) + cardScore(ev.target);
      // 第 1 步：出的牌飞向目标牌位置
      this.steps.push({
        flies: [
          {
            id: ev.card,
            from,
            to: targetSlot,
            w: TABLE_CARD_W,
            t: 0,
            dur: 0.32,
            faceUp: true,
          },
        ],
        popups: [],
        hide: [ev.card, ev.target],
        hold: FLY_TARGET_HOLD_S,
      });
      // 第 2 步：两张牌飞到屏幕正中展示，停 5 秒
      const centerX = this.w / 2;
      const centerY = H / 2;
      const matchW = TABLE_CARD_W * 1.3; // 稍微放大突出展示
      this.steps.push({
        flies: [
          {
            id: ev.card,
            from: targetSlot,
            to: { x: centerX - matchW - 10, y: centerY },
            w: matchW,
            t: 0,
            dur: 0.35,
            faceUp: true,
          },
          {
            id: ev.target,
            from: targetSlot,
            to: { x: centerX + 10, y: centerY },
            w: matchW,
            t: 0,
            dur: 0.35,
            faceUp: true,
          },
        ],
        popups:
          gain > 0
            ? [
                {
                  text: `MATCH! +${gain}`,
                  at: {
                    x: centerX,
                    y: centerY - matchW * CARD_RATIO * 0.5 - 20,
                  },
                  t: 0,
                },
              ]
            : [],
        hide: [ev.card, ev.target],
        hold: MATCH_HOLD_S,
      });
      // 第 3 步：两张牌飞入得分堆
      this.steps.push({
        flies: [
          {
            id: ev.card,
            from: { x: centerX - matchW - 10, y: centerY },
            to: pile,
            w: TABLE_CARD_W,
            t: 0,
            dur: 0.42,
            faceUp: true,
          },
          {
            id: ev.target,
            from: { x: centerX + 10, y: centerY },
            to: pile,
            w: TABLE_CARD_W,
            t: 0,
            dur: 0.42,
            faceUp: true,
          },
        ],
        popups: [],
        hide: [ev.card, ev.target],
        hold: FLY_PILE_HOLD_S,
      });
    }
  }

  get animating(): boolean {
    return this.current !== null || this.steps.length > 0;
  }

  private stepAnim(dt: number): void {
    if (!this.current) {
      this.current = this.steps.shift() ?? null;
      this.hidden = new Set(this.current?.hide ?? []);
      if (!this.current) return;
    }
    const s = this.current;
    let done = true;
    for (const f of s.flies) {
      f.t = Math.min(f.dur, f.t + dt);
      if (f.t < f.dur) done = false;
    }
    for (const p of s.popups) p.t += dt;
    if (!done) return;
    // 飞行完成后再停留 hold 秒，每一手牌都看得清
    s.hold -= dt;
    if (s.hold <= 0) {
      this.current = null;
      this.hidden.clear();
    }
  }

  render(dt: number): void {
    const ctx = this.ctx;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    ctx.save();
    ctx.fillStyle = C.feltOuter;
    ctx.fillRect(0, 0, cw, ch);
    if (this.rotated) {
      // 竖屏：整幅画面顺时针旋 90°，逻辑原点落在屏幕右上角
      ctx.translate(cw, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.translate(this.pad.x, this.pad.y);
    ctx.scale(this.scale, this.scale);

    this.stepAnim(dt);
    this.drawFelt(ctx);
    if (this.state) {
      this.layout();
      this.drawDeck(ctx);
      this.drawTable(ctx);
      this.drawPanels(ctx);
      this.drawHand(ctx);
      this.drawFlies(ctx);
    }
    ctx.restore();
  }

  // ---------- 布局 ----------

  private layout(): void {
    const table: number[] = [...this.state.table];
    this.tableSlots.clear();
    const cols = Math.min(9, Math.max(1, table.length));
    const gap = 12;
    const rows = Math.ceil(table.length / cols);
    const rowH = TABLE_CARD_W * CARD_RATIO + gap;
    const area = this.area;
    const startY = area.y + (area.h - rows * rowH + gap) / 2;
    table.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, table.length - row * cols);
      const rowW = inRow * TABLE_CARD_W + (inRow - 1) * gap;
      const startX = area.x + (area.w - rowW) / 2;
      this.tableSlots.set(id, {
        x: startX + (i % cols) * (TABLE_CARD_W + gap),
        y: startY + row * rowH,
        w: TABLE_CARD_W,
      });
    });

    this.handSlots.clear();
    const n = this.hand.length;
    if (n) {
      // 手牌摆得太密会使手机上可点区域不足 44px，尽量摆开（两侧各留 100 逻辑像素）
      const maxW = this.w - 200;
      const step = Math.min(HAND_W + 10, maxW / n);
      const totalW = step * (n - 1) + HAND_W;
      const startX = (this.w - totalW) / 2;
      const baseY = H - HAND_W * CARD_RATIO - 30;
      this.hand.forEach((id, i) => {
        // 轻微弧形排列，中间略高
        const k = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        const lift = this.selected === id ? 22 : 0;
        this.handSlots.set(id, {
          x: startX + i * step,
          y: baseY + k * k * 10 - lift,
          w: HAND_W,
        });
      });
    }

    this.pilePos.clear();
    const count = this.state.players.size;
    for (let seat = 0; seat < count; seat++)
      this.pilePos.set(seat, this.panelPos(seat));
  }

  /** 座位在屏幕上的面板中心：自己在下，其余按 右→上→左 排布 */
  private panelPos(seat: number): Pt {
    const count = this.state?.players.size ?? 4;
    const rel = (seat - this.mySeat + count) % count;
    const right = this.w - 108;
    const mid = this.w / 2;
    // 自己的面板放在左侧偏下，避开手牌区域
    if (rel === 0) return { x: 108, y: 474 };
    if (count === 2) return { x: mid, y: 62 };
    if (count === 3)
      return rel === 1 ? { x: right, y: 300 } : { x: 108, y: 300 };
    return rel === 1
      ? { x: right, y: 300 }
      : rel === 2
      ? { x: mid, y: 62 }
      : { x: 108, y: 300 };
  }

  // ---------- 绘制 ----------

  private drawFelt(ctx: CanvasRenderingContext2D): void {
    const W = this.w;
    const g = ctx.createRadialGradient(
      W / 2,
      H / 2,
      80,
      W / 2,
      H / 2,
      W * 0.62
    );
    g.addColorStop(0, C.feltInner);
    g.addColorStop(1, C.feltOuter);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 桌面暗金边框与四角回纹
    ctx.strokeStyle = "rgba(201,169,97,0.28)";
    ctx.lineWidth = 2;
    roundRect(ctx, 26, 26, W - 52, H - 52, 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(201,169,97,0.5)";
    ctx.lineWidth = 3;
    const c = 34;
    [
      [40, 40, 1, 1],
      [W - 40, 40, -1, 1],
      [40, H - 40, 1, -1],
      [W - 40, H - 40, -1, -1],
    ].forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * c);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * c, y);
      ctx.stroke();
    });

    // 中央印章水印（置于桌面牌区下方的空白处）
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = C.gold;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 130px "Songti SC", "STSong", serif`;
    ctx.fillText("捡红点", W / 2, 500);
    ctx.restore();
  }

  private drawDeck(ctx: CanvasRenderingContext2D): void {
    const n = this.state.stockCount as number;
    for (let i = Math.min(4, n) - 1; i >= 0; i--)
      drawCard(ctx, 0, DECK.x + i * 2, DECK.y - i * 2, DECK.w, {
        faceUp: false,
      });
    ctx.fillStyle = C.cream;
    ctx.textAlign = "center";
    ctx.font = `600 20px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(
      `牌堆 ${n}`,
      DECK.x + DECK.w / 2,
      DECK.y + DECK.w * CARD_RATIO + 26
    );
  }

  private drawTable(ctx: CanvasRenderingContext2D): void {
    const pending = this.state.pendingStockCard as number;
    const choosing = this.state.turnPhase === "CHOOSE_STOCK_TARGET";
    for (const [id, s] of this.tableSlots) {
      if (this.hidden.has(id)) continue;
      const isTarget = this.targets.includes(id);
      drawCard(ctx, id, s.x, s.y, s.w, {
        highlight: isTarget,
        dim: (this.selected >= 0 || choosing) && !isTarget,
      });
    }
    // 翻出待选目标的牌悬在桌面上方
    if (choosing && pending >= 0) {
      const area = this.area;
      const x = area.x + area.w / 2 - TABLE_CARD_W / 2;
      drawCard(ctx, pending, x, area.y - 104, TABLE_CARD_W, {
        selected: true,
      });
      ctx.fillStyle = C.gold;
      ctx.textAlign = "center";
      ctx.font = `600 18px "Songti SC", serif`;
      ctx.fillText("选择要吃的牌", x + TABLE_CARD_W / 2, area.y - 116);
    }
  }

  private drawHand(ctx: CanvasRenderingContext2D): void {
    const myTurn = this.state.currentSeat === this.mySeat;
    for (const [id, s] of this.handSlots) {
      if (this.hidden.has(id)) continue;
      drawCard(ctx, id, s.x, s.y, s.w, {
        selected: this.selected === id,
        dim: !myTurn,
      });
    }
    // 得分堆：在手牌上方展示已吃到的牌
    this.drawCaptured(ctx);
  }

  /** 已吃到的牌展示（手牌上方，缩小牌面排列） */
  private drawCaptured(ctx: CanvasRenderingContext2D): void {
    const me = [...this.state.players.values()].find((p: any) => p.seat === this.mySeat) as any;
    if (!me || !me.captured || me.captured.length === 0) return;
    const cards: number[] = [...me.captured];
    const cw = 36; // 得分堆牌尺寸更小
    const gap = 4;
    const step = Math.min(cw + gap, (this.w - 100) / cards.length);
    const totalW = step * (cards.length - 1) + cw;
    const startX = (this.w - totalW) / 2;
    const y = H - HAND_W * CARD_RATIO - 30 - cw * CARD_RATIO - 16; // 手牌上方
    // 背景条
    ctx.save();
    roundRect(ctx, startX - 8, y - 4, totalW + 16, cw * CARD_RATIO + 8, 6);
    ctx.fillStyle = 'rgba(8,26,20,0.5)';
    ctx.fill();
    ctx.restore();
    // 画每张小牌
    cards.forEach((id, i) => {
      drawCard(ctx, id, startX + i * step, y, cw);
    });
    // 标签
    ctx.fillStyle = C.cream;
    ctx.textAlign = 'left';
    ctx.font = `13px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(`得分堆 (${cards.length}张)`, startX, y - 10);
  }

  private drawPanels(ctx: CanvasRenderingContext2D): void {
    const players = [...this.state.players.values()] as any[];
    for (const p of players) {
      const pos = this.panelPos(p.seat);
      const active = this.state.currentSeat === p.seat;
      const isMe = p.seat === this.mySeat;

      // 底板
      ctx.save();
      roundRect(ctx, pos.x - 88, pos.y - 42, 176, 84, 12);
      ctx.fillStyle = "rgba(8,26,20,0.72)";
      ctx.fill();
      ctx.strokeStyle = active ? C.gold : "rgba(201,169,97,0.3)";
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      ctx.restore();

      // 头像与倒计时环
      const ax = pos.x - 54;
      const ay = pos.y;
      ctx.beginPath();
      ctx.arc(ax, ay, 24, 0, Math.PI * 2);
      ctx.fillStyle = p.connected ? "#2b5c48" : "#4a4a4a";
      ctx.fill();
      ctx.strokeStyle = C.goldDim;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = C.cream;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 20px "Songti SC", serif`;
      ctx.fillText(p.name.slice(0, 1), ax, ay + 1);
      if (active && this.state.turnDeadline > 0) {
        const left = Math.max(0, this.state.turnDeadline - Date.now());
        const ratio = Math.min(1, left / 20000);
        ctx.beginPath();
        ctx.arc(ax, ay, 30, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
        ctx.strokeStyle = ratio < 0.25 ? C.seal : C.gold;
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // 名字 / 分数 / 剩牌
      ctx.textAlign = "left";
      ctx.fillStyle = isMe ? C.gold : C.cream;
      ctx.font = `600 17px "Songti SC", serif`;
      ctx.fillText(p.name + (p.isAi ? " ·电脑" : ""), pos.x - 22, pos.y - 16);
      ctx.fillStyle = C.cream;
      ctx.font = `600 15px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(`${p.points} 分`, pos.x - 22, pos.y + 6);
      ctx.fillStyle = "rgba(243,234,214,0.65)";
      ctx.font = `13px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(`余 ${p.handCount} 张`, pos.x - 22, pos.y + 26);
      if (!p.connected) {
        ctx.fillStyle = C.seal;
        ctx.font = `600 13px "Songti SC", serif`;
        ctx.fillText("掉线托管", pos.x + 40, pos.y - 16);
      }
    }
  }

  private drawFlies(ctx: CanvasRenderingContext2D): void {
    const s = this.current;
    if (!s) return;
    for (const f of s.flies) {
      const k = ease(Math.min(1, f.t / f.dur));
      drawCard(
        ctx,
        f.id,
        f.from.x + (f.to.x - f.from.x) * k,
        f.from.y + (f.to.y - f.from.y) * k,
        f.w,
        {
          faceUp: f.faceUp,
        }
      );
    }
    for (const p of s.popups) {
      const k = Math.min(1, p.t / 0.7);
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = C.gold;
      ctx.textAlign = "center";
      ctx.font = `700 30px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(p.text, p.at.x, p.at.y - 30 - k * 40);
      ctx.restore();
    }
  }
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
