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
  HIT_HOLD_S,
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
  /** 牌堆翻出：飞行中牌背缩→正面展开 */
  flip?: boolean;
}

interface Popup {
  text: string;
  at: Pt;
  t: number;
  sparkle?: boolean;
  hint?: boolean;
  hit?: boolean;
  gain?: number;
}

/** 一个动画步骤，按顺序播放，让玩家看清每次吃牌 */
interface Step {
  flies: Fly[];
  popups: Popup[];
  /** 播放期间隐藏这些牌的静态位置，避免与飞行的牌重影 */
  hide: number[];
  /** 飞行结束后的停顿，给眼睛一点反应时间 */
  hold: number;
  /** 本步开始时牌堆显示数 -1（对应一次 fromStock 翻牌） */
  decStock?: boolean;
  /** 本步结束后才允许这些牌出现在桌面/待选位 */
  revealOnDone?: number[];
  /** 本步开始时从桌面暂留中移除（进入 MATCH） */
  clearLinger?: number[];
  /** 飞入得分堆结束后才把分/牌计入面板（所见即所得） */
  commitCapture?: { seat: number; cards: number[]; gain: number };
  /** 本步结束后才扣减余牌数显示 */
  commitHand?: number;
  /** 本步开始时高亮该座位 */
  visualSeat?: number;
}

export interface TableCallbacks {
  onPickHand(cardId: number): void;
  onPickTable(cardId: number): void;
  onToggleCaptured?(): void;
  onCancelSelection?(): void;
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
  /** 翻牌动画未完成前，不把牌堆牌画到桌面/待选 */
  private deferredReveal = new Set<number>();
  /** 状态已移走但仍需画在桌面的牌（等命中/MATCH） */
  private lingerTable = new Map<number, Slot>();
  private animClock = 0;
  /** 已同步但翻牌动画未开始的牌堆张数，用于延后扣减显示 */
  private stockAnimCredit = 0;
  /** 状态已加分但入堆动画未完：面板先扣回这些分 */
  private pendingGain = new Map<number, number>();
  /** 状态已入堆但飞行动画未完：得分条先不展示这些牌 */
  private pendingCards = new Map<number, Set<number>>();
  /** 状态已扣手牌但出牌动画未完：余牌数先加回 */
  private pendingHand = new Map<number, number>();
  private capturedHit: { x: number; y: number; w: number; h: number } | null =
    null;

  /** 由外部每帧提供的渲染数据 */
  state: any = null;
  hand: number[] = [];
  mySeat = 0;
  selected = -1;
  targets: number[] = [];
  /** 弃牌二次确认中的牌 id，-1 表示无 */
  discardArmed = -1;
  /** 展开得分堆明细 */
  showCaptured = false;
  /** 外部置位：上家动画/状态抖动期间锁手牌与回合 UI */
  turnBlocked = false;
  /** 动画播放中仍高亮出手座位，避免回合指示提前跳走 */
  private visualTurnSeat: number | null = null;

  constructor(private canvas: HTMLCanvasElement, private cb: TableCallbacks) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    onOrientationChange(() => this.resize());
    canvas.addEventListener("pointerdown", (e) => this.onPointer(e));
  }

  /** 状态已到、动画未到：先藏起桌面新牌 */
  deferTableCard(id: number): void {
    if (id >= 0) this.deferredReveal.add(id);
  }

  /** 对比新旧状态，把新上台面的牌/新待选牌先藏起 */
  deferStateArrivals(prev: any, next: any): void {
    if (!next || next.phase !== "PLAYING") return;
    // 仅对局中增量同步时延后，开局发牌不藏
    if (prev?.phase !== "PLAYING") return;
    if (prev.table) {
      const old = new Set(prev.table as number[]);
      for (const id of next.table as number[]) {
        if (!old.has(id)) this.deferredReveal.add(id);
      }
    }
    if (
      typeof next.pendingStockCard === "number" &&
      next.pendingStockCard >= 0 &&
      next.pendingStockCard !== prev.pendingStockCard
    ) {
      this.deferredReveal.add(next.pendingStockCard);
    }
  }

  /** 桌面明牌区：顶部给对手面板留白，避免与桌面牌重叠 */
  private get area() {
    return { x: 236, y: 168, w: this.w - 472, h: 280 };
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

    if (this.animating) {
      this.skipHold();
      return;
    }

    if (this.capturedHit) {
      const h = this.capturedHit;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        this.cb.onToggleCaptured?.();
        return;
      }
    }

    // 手牌在上层，优先命中；同层从右往左（后绘制的在上）
    // 触屏加大命中外扩；竖屏软件旋转后再放大（物理牌面更窄）
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const pad = coarse ? (this.rotated ? 22 : 12) : 0;
    const hit = (slots: Map<number, Slot>) => {
      const entries = [...slots.entries()].reverse();
      for (const [id, s] of entries)
        if (
          x >= s.x - pad &&
          x <= s.x + s.w + pad &&
          y >= s.y - pad &&
          y <= s.y + s.w * CARD_RATIO + pad
        )
          return id;
      return -1;
    };
    const handId = hit(this.handSlots);
    if (handId >= 0) return this.cb.onPickHand(handId);
    const t = hit(this.tableSlots);
    if (t >= 0) return this.cb.onPickTable(t);
    this.cb.onCancelSelection?.();
  }

  /** 跳过当前步骤剩余停顿（MATCH 等） */
  skipHold(): void {
    if (!this.current) return;
    const flying = this.current.flies.some((f) => f.t < f.dur);
    if (flying) return;
    this.current.hold = 0;
  }

  /** 把服务器事件转成动画步骤 */
  pushEvents(events: GameEvent[]): void {
    const pendingPos = () => ({
      x: this.w / 2 - TABLE_CARD_W / 2,
      y: 118,
    });
    for (const ev of events) {
      const fromStock = ev.type === "FLIP" && !!ev.fromStock;
      if (fromStock) this.stockAnimCredit++;
      // 状态可能已写入桌面，翻牌飞完前先藏起来
      if (ev.type === "FLIP") this.deferredReveal.add(ev.card);

      const from =
        ev.type === "FLIP"
          ? fromStock
            ? { x: DECK.x, y: DECK.y }
            : pendingPos()
          : this.handSlots.get(ev.card) ?? this.panelPos(ev.player);
      const pile = this.pilePos.get(ev.player) ?? { x: this.w / 2, y: H / 2 };

      if (ev.target === undefined) {
        // 无目标：手牌/翻牌弃到桌面，或多目标翻出到待选位
        const to =
          ev.type === "FLIP" && ev.awaitChoice
            ? pendingPos()
            : this.slotForTableCard(ev.card) ?? {
                x: this.area.x + this.area.w / 2,
                y: this.area.y,
              };
        if (ev.type === "PLAY") this.deferHand(ev.player);
        this.steps.push({
          flies: [
            {
              id: ev.card,
              from,
              to,
              w: TABLE_CARD_W,
              t: 0,
              dur: fromStock ? 0.48 : 0.34,
              faceUp: !fromStock,
              flip: fromStock,
            },
          ],
          popups: [],
          hide: [ev.card],
          hold: DISCARD_HOLD_S,
          decStock: fromStock,
          revealOnDone: [ev.card],
          commitHand: ev.type === "PLAY" ? ev.player : undefined,
          visualSeat: ev.player,
        });
        continue;
      }

      // 吃牌：出的牌飞到目标（目标仍留桌面）→ 命中反馈 → MATCH → 飞入得分堆
      const targetSlot = this.tableSlots.get(ev.target) ??
        this.lingerTable.get(ev.target) ?? {
          x: this.w / 2,
          y: this.area.y + 100,
          w: TABLE_CARD_W,
        };
      if (this.tableSlots.has(ev.target))
        this.lingerTable.set(ev.target, { ...this.tableSlots.get(ev.target)! });
      const hitSlot = {
        x: targetSlot.x + 6,
        y: targetSlot.y + TABLE_CARD_W * CARD_RATIO * 0.28,
        w: TABLE_CARD_W,
      };
      const gain = cardScore(ev.card) + cardScore(ev.target);
      this.deferCapture(ev.player, [ev.card, ev.target], gain);
      if (ev.type === "PLAY") this.deferHand(ev.player);
      // 第 1 步：出的牌飞向目标，目标牌仍留在桌面
      this.steps.push({
        flies: [
          {
            id: ev.card,
            from,
            to: hitSlot,
            w: TABLE_CARD_W,
            t: 0,
            dur: fromStock ? 0.48 : 0.32,
            faceUp: !fromStock,
            flip: fromStock,
          },
        ],
        popups: [],
        hide: [ev.card],
        hold: FLY_TARGET_HOLD_S,
        decStock: fromStock,
        visualSeat: ev.player,
      });
      // 第 2 步：命中反馈
      this.steps.push({
        flies: [
          {
            id: ev.card,
            from: hitSlot,
            to: hitSlot,
            w: TABLE_CARD_W,
            t: 0,
            dur: HIT_HOLD_S,
            faceUp: true,
          },
        ],
        popups: [
          {
            text: "√",
            at: {
              x: hitSlot.x + TABLE_CARD_W * 0.82,
              y: hitSlot.y + TABLE_CARD_W * CARD_RATIO * 0.22,
            },
            t: 0,
            hit: true,
            gain,
          },
        ],
        hide: [ev.card],
        hold: 0,
        visualSeat: ev.player,
      });
      // 第 3 步：两张牌飞到屏幕正中展示
      const centerX = this.w / 2;
      const centerY = H / 2;
      const matchW = TABLE_CARD_W * 1.3;
      this.steps.push({
        flies: [
          {
            id: ev.target,
            from: targetSlot,
            to: { x: centerX + 10, y: centerY },
            w: matchW,
            t: 0,
            dur: 0.35,
            faceUp: true,
          },
          {
            id: ev.card,
            from: hitSlot,
            to: { x: centerX - matchW - 10, y: centerY },
            w: matchW,
            t: 0,
            dur: 0.35,
            faceUp: true,
          },
        ],
        popups: [
          {
            text: gain > 0 ? `MATCH! +${gain}` : "MATCH!",
            at: {
              x: centerX,
              y: centerY - matchW * CARD_RATIO * 0.5 - 20,
            },
            t: 0,
            sparkle: true,
            gain,
          },
          {
            text: "点击任意处跳过",
            at: { x: centerX, y: this.rotated ? H - 64 : H - 48 },
            t: 0,
            hint: true,
          },
        ],
        hide: [ev.card, ev.target],
        hold: MATCH_HOLD_S,
        clearLinger: [ev.target],
        visualSeat: ev.player,
      });
      // 第 4 步：两张牌飞入得分堆
      this.steps.push({
        flies: [
          {
            id: ev.target,
            from: { x: centerX + 10, y: centerY },
            to: pile,
            w: TABLE_CARD_W,
            t: 0,
            dur: 0.42,
            faceUp: true,
          },
          {
            id: ev.card,
            from: { x: centerX - matchW - 10, y: centerY },
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
        revealOnDone: ev.type === "FLIP" ? [ev.card] : undefined,
        commitCapture: {
          seat: ev.player,
          cards: [ev.card, ev.target],
          gain,
        },
        commitHand: ev.type === "PLAY" ? ev.player : undefined,
        visualSeat: ev.player,
      });
    }
  }

  private deferHand(seat: number): void {
    this.pendingHand.set(seat, (this.pendingHand.get(seat) ?? 0) + 1);
  }

  private applyHandCommit(seat: number): void {
    const left = (this.pendingHand.get(seat) ?? 0) - 1;
    if (left <= 0) this.pendingHand.delete(seat);
    else this.pendingHand.set(seat, left);
  }

  private displayHandCount(p: { seat: number; handCount?: number }): number {
    return (p.handCount ?? 0) + (this.pendingHand.get(p.seat) ?? 0);
  }

  private deferCapture(seat: number, cards: number[], gain: number): void {
    this.pendingGain.set(seat, (this.pendingGain.get(seat) ?? 0) + gain);
    let set = this.pendingCards.get(seat);
    if (!set) {
      set = new Set();
      this.pendingCards.set(seat, set);
    }
    for (const id of cards) set.add(id);
  }

  private applyCaptureCommit(info: {
    seat: number;
    cards: number[];
    gain: number;
  }): void {
    const left = (this.pendingGain.get(info.seat) ?? 0) - info.gain;
    if (left <= 0) this.pendingGain.delete(info.seat);
    else this.pendingGain.set(info.seat, left);
    const set = this.pendingCards.get(info.seat);
    if (!set) return;
    for (const id of info.cards) set.delete(id);
    if (set.size === 0) this.pendingCards.delete(info.seat);
  }

  private displayPoints(p: { seat: number; points?: number }): number {
    return Math.max(0, (p.points ?? 0) - (this.pendingGain.get(p.seat) ?? 0));
  }

  private displayCaptured(me: {
    seat: number;
    captured?: number[];
  }): number[] {
    const cards: number[] = me.captured ? [...me.captured] : [];
    const pending = this.pendingCards.get(me.seat);
    if (!pending?.size) return cards;
    return cards.filter((id) => !pending.has(id));
  }

  get animating(): boolean {
    return this.current !== null || this.steps.length > 0;
  }

  /** 新一轮开始时清掉未提交的显示延迟 */
  resetAnimVisuals(): void {
    this.steps.length = 0;
    this.current = null;
    this.hidden.clear();
    this.deferredReveal.clear();
    this.lingerTable.clear();
    this.stockAnimCredit = 0;
    this.pendingGain.clear();
    this.pendingCards.clear();
    this.pendingHand.clear();
    this.visualTurnSeat = null;
  }

  private stepAnim(dt: number): void {
    this.animClock += dt;
    if (!this.current) {
      this.current = this.steps.shift() ?? null;
      this.hidden = new Set(this.current?.hide ?? []);
      if (!this.current) return;
      if (this.current.visualSeat !== undefined)
        this.visualTurnSeat = this.current.visualSeat;
      if (this.current.clearLinger) {
        for (const id of this.current.clearLinger) this.lingerTable.delete(id);
      }
      if (this.current.decStock)
        this.stockAnimCredit = Math.max(0, this.stockAnimCredit - 1);
    }
    const s = this.current;
    let done = true;
    for (const f of s.flies) {
      f.t = Math.min(f.dur, f.t + dt);
      if (f.t < f.dur) done = false;
    }
    for (const p of s.popups) p.t += dt;
    if (!done) return;
    s.hold -= dt;
    if (s.hold <= 0) {
      if (s.revealOnDone) {
        for (const id of s.revealOnDone) this.deferredReveal.delete(id);
      }
      if (s.commitCapture) this.applyCaptureCommit(s.commitCapture);
      if (s.commitHand !== undefined) this.applyHandCommit(s.commitHand);
      this.current = null;
      this.hidden.clear();
      if (!this.steps.length) this.visualTurnSeat = null;
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

  /** 含尚未揭晓牌的落点（飞牌终点），不用于静态绘制 */
  private slotForTableCard(cardId: number): Pt | null {
    if (!this.state) return null;
    const slots = this.computeTableSlots([...this.state.table]);
    return slots.get(cardId) ?? null;
  }

  private computeTableSlots(table: number[]): Map<number, Slot> {
    const slots = new Map<number, Slot>();
    if (!table.length) return slots;
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
      slots.set(id, {
        x: startX + (i % cols) * (TABLE_CARD_W + gap),
        y: startY + row * rowH,
        w: TABLE_CARD_W,
      });
    });
    return slots;
  }

  private layout(): void {
    const table: number[] = [...this.state.table].filter(
      (id) => !this.deferredReveal.has(id)
    );
    this.tableSlots = this.computeTableSlots(table);

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

  /** 座位在屏幕上的面板中心：自己在下，其余按人数排布 */
  private panelPos(seat: number): Pt {
    const count = this.state?.players.size ?? 4;
    const rel = (seat - this.mySeat + count) % count;
    const right = this.w - 108;
    const mid = this.w / 2;
    // 2 人：标准对战，对手正上方，自己左下避开手牌
    if (count === 2)
      return rel === 0 ? { x: 108, y: 474 } : { x: mid, y: 58 };
    if (rel === 0) return { x: 108, y: 474 };
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
    const n = (this.state.stockCount as number) + this.stockAnimCredit;
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
    const choosing =
      this.state.turnPhase === "CHOOSE_STOCK_TARGET" &&
      !this.animating &&
      !this.turnBlocked;
    for (const [id, s] of this.tableSlots) {
      if (this.hidden.has(id) || this.deferredReveal.has(id)) continue;
      const isTarget = this.targets.includes(id);
      drawCard(ctx, id, s.x, s.y, s.w, {
        highlight: isTarget,
        pulse: isTarget ? this.animClock : undefined,
        dim: (this.selected >= 0 || choosing) && !isTarget,
      });
    }
    for (const [id, s] of this.lingerTable) {
      if (this.hidden.has(id) || this.tableSlots.has(id)) continue;
      drawCard(ctx, id, s.x, s.y, s.w);
    }
    if (
      choosing &&
      pending >= 0 &&
      !this.hidden.has(pending) &&
      !this.deferredReveal.has(pending)
    ) {
      const x = this.w / 2 - TABLE_CARD_W / 2;
      const y = 118;
      drawCard(ctx, pending, x, y, TABLE_CARD_W, { selected: true });
      ctx.fillStyle = C.gold;
      ctx.textAlign = "center";
      ctx.font = `700 22px "Songti SC", serif`;
      ctx.fillText("选择要吃的牌", this.w / 2, y - 18);
    }
  }

  private drawHand(ctx: CanvasRenderingContext2D): void {
    // 状态可能已轮到自己，但上家动画未完：手牌保持熄灭
    const myTurn =
      this.state.currentSeat === this.mySeat &&
      !this.animating &&
      !this.turnBlocked;
    for (const [id, s] of this.handSlots) {
      if (this.hidden.has(id)) continue;
      drawCard(ctx, id, s.x, s.y, s.w, {
        selected: this.selected === id && this.discardArmed !== id && myTurn,
        discard: this.discardArmed === id && myTurn,
        dim: !myTurn,
      });
    }
    this.drawCaptured(ctx);
  }

  /** 已吃牌：左下角固定入口，0 张也显示 */
  private drawCaptured(ctx: CanvasRenderingContext2D): void {
    this.capturedHit = null;
    const me = [...this.state.players.values()].find(
      (p: any) => p.seat === this.mySeat
    ) as any;
    if (!me) return;
    const cards = this.displayCaptured(me);
    const barW = 148;
    const barH = 36;
    const x = 14;
    const y = H - HAND_W * CARD_RATIO - 78;
    this.capturedHit = { x, y, w: barW, h: barH };

    ctx.save();
    roundRect(ctx, x, y, barW, barH, 10);
    ctx.fillStyle = "rgba(8,26,20,0.72)";
    ctx.fill();
    ctx.strokeStyle = C.goldDim;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 15px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(
      `已吃牌 ${cards.length}${this.showCaptured ? " ∧" : " ∨"}`,
      x + barW / 2,
      y + barH / 2
    );
    ctx.restore();

    if (!this.showCaptured) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cw = coarse ? 36 : 44;
    const gap = 6;
    const cols = Math.min(Math.max(cards.length, 1), coarse ? 5 : 8);
    const rows = Math.max(1, Math.ceil(Math.max(cards.length, 1) / cols));
    const panelW = cols * (cw + gap) + 16;
    const panelH = rows * (cw * CARD_RATIO + gap) + 48;
    const px = 14;
    const py = Math.max(80, y - panelH - 8);
    this.capturedHit = {
      x: Math.min(x, px),
      y: Math.min(y, py),
      w: Math.max(x + barW, px + panelW) - Math.min(x, px),
      h: Math.max(y + barH, py + panelH) - Math.min(y, py),
    };
    ctx.save();
    roundRect(ctx, px, py, panelW, panelH, 12);
    ctx.fillStyle = "rgba(8,26,20,0.92)";
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.textAlign = "center";
    ctx.font = `600 14px "Songti SC", serif`;
    ctx.fillText(
      cards.length ? "已吃牌（再点关闭）" : "暂无已吃牌",
      px + panelW / 2,
      py + 18
    );
    cards.forEach((id, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawCard(
        ctx,
        id,
        px + 8 + col * (cw + gap),
        py + 28 + row * (cw * CARD_RATIO + gap),
        cw
      );
    });
    ctx.fillStyle = C.gold;
    ctx.font = `700 18px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText("∧", px + panelW / 2, py + panelH - 12);
    ctx.restore();
  }

  private drawPanels(ctx: CanvasRenderingContext2D): void {
    const players = [...this.state.players.values()] as any[];
    const turnSeat =
      this.animating && this.visualTurnSeat !== null
        ? this.visualTurnSeat
        : this.state.currentSeat;
    for (const p of players) {
      const pos = this.panelPos(p.seat);
      const active = turnSeat === p.seat;
      const isMe = p.seat === this.mySeat;
      const starter = this.state.roundStarter === p.seat;
      const name = String(p.name ?? "");
      ctx.font = `600 17px "Songti SC", serif`;
      const nameW = ctx.measureText(name).width;
      const tagW = (p.isAi ? 22 : 0) + (starter ? 22 : 0);
      const panelW = Math.min(220, Math.max(148, 78 + nameW + tagW));
      const panelH = 84;
      const left = pos.x - panelW / 2;

      ctx.save();
      roundRect(ctx, left, pos.y - panelH / 2, panelW, panelH, 12);
      ctx.fillStyle = "rgba(8,26,20,0.72)";
      ctx.fill();
      ctx.strokeStyle = active ? C.gold : "rgba(201,169,97,0.3)";
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      ctx.restore();

      const ax = left + 28;
      const ay = pos.y;
      ctx.beginPath();
      ctx.arc(ax, ay, 22, 0, Math.PI * 2);
      ctx.fillStyle = p.connected ? "#2b5c48" : "#4a4a4a";
      ctx.fill();
      ctx.strokeStyle = C.goldDim;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = C.cream;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 18px "Songti SC", serif`;
      ctx.fillText(name.slice(0, 1) || "?", ax, ay + 1);
      if (p.isAi) {
        roundRect(ctx, ax + 10, ay - 26, 18, 14, 4);
        ctx.fillStyle = C.seal;
        ctx.fill();
        ctx.fillStyle = C.cream;
        ctx.font = `700 10px "Songti SC", serif`;
        ctx.fillText("机", ax + 19, ay - 19);
      }
      if (active && !this.animating && this.state.turnDeadline > 0) {
        const leftMs = Math.max(0, this.state.turnDeadline - Date.now());
        const ratio = Math.min(1, leftMs / 20000);
        ctx.beginPath();
        ctx.arc(ax, ay, 28, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
        ctx.strokeStyle = ratio < 0.25 ? C.seal : C.gold;
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      const tx = ax + 34;
      const maxTextW = left + panelW - 10 - tx;
      ctx.textAlign = "left";
      ctx.fillStyle = isMe ? C.gold : C.cream;
      ctx.font = `600 17px "Songti SC", serif`;
      this.fillFitText(ctx, name, tx, pos.y - 16, maxTextW);
      if (starter) {
        const nw = Math.min(ctx.measureText(name).width, maxTextW);
        ctx.fillStyle = C.goldDim;
        ctx.font = `600 12px "Songti SC", serif`;
        ctx.fillText("庄", tx + nw + 6, pos.y - 16);
      }
      ctx.fillStyle = C.cream;
      ctx.font = `600 15px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(`${this.displayPoints(p)} 分`, tx, pos.y + 6);
      ctx.fillStyle = "rgba(243,234,214,0.65)";
      ctx.font = `13px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(`余 ${this.displayHandCount(p)} 张`, tx, pos.y + 26);
      if (!p.connected) {
        ctx.fillStyle = C.seal;
        ctx.font = `600 12px "Songti SC", serif`;
        ctx.fillText("掉线", left + panelW - 36, pos.y - 28);
      }
    }
  }

  private fillFitText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number
  ): void {
    if (ctx.measureText(text).width <= maxW) {
      ctx.fillText(text, x, y);
      return;
    }
    let s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW)
      s = s.slice(0, -1);
    ctx.fillText(s + "…", x, y);
  }

  private drawFlies(ctx: CanvasRenderingContext2D): void {
    const s = this.current;
    if (!s) return;
    for (const f of s.flies) {
      const k = ease(Math.min(1, f.t / f.dur));
      let faceUp = f.faceUp;
      let scaleX = 1;
      if (f.flip) {
        const p = Math.min(1, f.t / f.dur);
        if (p < 0.5) {
          faceUp = false;
          scaleX = 1 - p * 2;
        } else {
          faceUp = true;
          scaleX = (p - 0.5) * 2;
        }
      }
      drawCard(
        ctx,
        f.id,
        f.from.x + (f.to.x - f.from.x) * k,
        f.from.y + (f.to.y - f.from.y) * k,
        f.w,
        {
          faceUp,
          scaleX,
        }
      );
    }
    for (const p of s.popups) {
      if (p.hint) {
        const flying = s.flies.some((f) => f.t < f.dur);
        if (flying || s.hold <= 0) continue;
        const pulse = 0.65 + 0.35 * Math.sin(this.animClock * 4);
        const capW = this.rotated ? 248 : 220;
        const capH = this.rotated ? 42 : 36;
        const fontPx = this.rotated ? 18 : 16;
        ctx.save();
        ctx.globalAlpha = pulse;
        roundRect(ctx, p.at.x - capW / 2, p.at.y - capH / 2, capW, capH, 18);
        ctx.fillStyle = "rgba(8,26,20,0.82)";
        ctx.fill();
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = C.gold;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 ${fontPx}px "Songti SC", "STSong", serif`;
        ctx.fillText(p.text, p.at.x, p.at.y);
        ctx.restore();
        continue;
      }
      const k = Math.min(1, p.t / 0.7);
      if (p.hit) {
        const pulse = 0.7 + 0.3 * Math.sin(this.animClock * 10);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = C.seal;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 42px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(p.text, p.at.x, p.at.y);
        ctx.restore();
        continue;
      }
      if (p.sparkle) {
        const n = (p.gain ?? 0) >= 30 ? 14 : 8;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + p.t * 2.2;
          const rad = 28 + p.t * 48 + (i % 3) * 10;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 0.85 - p.t * 0.35);
          ctx.fillStyle = i % 2 ? C.gold : "#fff3c4";
          ctx.beginPath();
          ctx.arc(
            p.at.x + Math.cos(ang) * rad,
            p.at.y + 10 + Math.sin(ang) * rad * 0.55,
            2.2 + (i % 3),
            0,
            Math.PI * 2
          );
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.shadowColor = C.gold;
        ctx.shadowBlur = 18;
        ctx.globalAlpha = 1 - k * k * 0.35;
        ctx.fillStyle = C.gold;
        ctx.textAlign = "center";
        ctx.font = `700 34px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(p.text, p.at.x, p.at.y - 24 - k * 28);
        ctx.restore();
        continue;
      }
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
