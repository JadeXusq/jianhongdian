/**
 * 牌桌视图：布局 / 绘制 / 命中测试 / 动画
 *
 * 坐标系：逻辑高度固定 720，逻辑宽度随屏幕比例伸缩（限制在 W_MIN~W_MAX）。
 * 竖屏触屏时软件旋转 90°，保证横屏玩法体验。
 */
import { cardScore, DECK_SIZE } from "@jhd/shared";
import type { GameEvent } from "@jhd/shared";
import {
  DISCARD_HOLD_S,
  FLY_TARGET_HOLD_S,
  HIT_HOLD_S,
  MATCH_HOLD_S,
  FLY_PILE_HOLD_S,
  DEAL_SHUFFLE_S,
  DEAL_FLY_S,
  DEAL_ROUND_PAUSE_S,
  DEAL_TABLE_PAUSE_S,
} from "@jhd/shared";
import { drawCard, roundRect } from "./cardRender";
import { themeFeltImg } from "./themeArt";
import { C, CARD_RATIO, currentThemeId } from "./theme";
import { shouldRotate, onOrientationChange } from "./layout";

const H = 720;
/** 逻辑宽度下限（近方屏如 4:3 平板）与上限（超长屏）*/
const W_MIN = 1040;
const W_MAX = 1700;
const HAND_W = 96;
const TABLE_CARD_W = 74;
const MAX_ANIM_STEPS = 24;
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
  /** 发牌动效配套音效 */
  dealSfx?: "shuffle" | "round" | "table";
}

export interface TableCallbacks {
  onPickHand(cardId: number): void;
  onPickTable(cardId: number): void;
  onToggleCaptured?(): void;
  onCancelSelection?(): void;
  onDealSfx?(kind: "shuffle" | "round" | "table"): void;
}

export class TableView {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  /** 居中留边 */
  private pad: Pt = { x: 0, y: 0 };
  /** 当前逻辑宽度，随屏幕比例变化 */
  private w = 1280;
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
  /** 状态已删、events 未到：暂留桌面牌位，防闪没 */
  private lingerHold = new Set<number>();
  /** 本回合桌面落点冻结：吃牌留空，新牌只追加，回合结束后再压实 */
  private tableLayoutFreeze: Map<number, Slot> | null = null;
  private animClock = 0;
  /** 已同步但翻牌动画未开始的牌堆张数，用于延后扣减显示 */
  private stockAnimCredit = 0;
  /** 状态已加分但入堆动画未完：面板先扣回这些分 */
  private pendingGain = new Map<number, number>();
  /** 状态已入堆但飞行动画未完：得分条先不展示这些牌 */
  private pendingCards = new Map<number, Set<number>>();
  /** 状态已扣手牌但出牌动画未完：余牌数先加回 */
  private pendingHand = new Map<number, number>();
  private capturedStackHit: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null = null;
  private capturedCloseHit: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null = null;

  /** 由外部每帧提供的渲染数据 */
  state: any = null;
  hand: number[] = [];
  mySeat = 0;
  selected = -1;
  targets: number[] = [];
  /** 弃牌二次确认中的牌 id，-1 表示无 */
  discardArmed = -1;
  /** 展开查看全部已吃牌 */
  showCaptured = false;
  /** 轮末：state 已 ROUND_OVER 但吃牌/翻牌动画未播完 */
  roundEnding = false;
  /** 外部置位：上家动画/状态抖动期间锁手牌与回合 UI */
  turnBlocked = false;
  /** 动画播放中仍高亮出手座位，避免回合指示提前跳走 */
  private visualTurnSeat: number | null = null;
  /** 开局发牌动画进行中 */
  private openingDeal = false;
  private dealArmed = false;
  private layoutBufW = 0;
  private layoutBufH = 0;
  private layoutDpr = 0;
  /** 本帧绘制/命中共用的 CSS 视口，避免读到不一致尺寸 */
  private viewCw = 0;
  private viewCh = 0;

  constructor(private canvas: HTMLCanvasElement, private cb: TableCallbacks) {
    this.ctx = canvas.getContext("2d")!;
    this.updateLayout();
    onOrientationChange(() => this.updateLayout());
    window.addEventListener("pageshow", () => this.updateLayout());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.updateLayout();
    });
    canvas.addEventListener("pointerdown", (e) => this.onPointer(e));
  }

  /** 状态已到、动画未到：先藏起桌面新牌 */
  deferTableCard(id: number): void {
    if (id >= 0) this.deferredReveal.add(id);
  }

  /** 对比新旧状态，把新上台面的牌/新待选牌先藏起；离桌的牌先 linger */
  deferStateArrivals(prev: any, next: any): void {
    if (!next || next.phase !== "PLAYING") return;
    if (prev?.phase !== "PLAYING") return;
    if (prev.table && next.table) {
      const prevTable = prev.table as number[];
      const nextTable = next.table as number[];
      const old = new Set(prevTable);
      const neu = new Set(nextTable);
      let prevSlots: Map<number, Slot> | null = null;
      let leftTable = false;
      let hasArrival = false;
      for (const id of nextTable) {
        if (old.has(id)) continue;
        hasArrival = true;
        this.deferredReveal.add(id);
      }
      for (const id of old) {
        if (neu.has(id)) continue;
        leftTable = true;
        let slot = this.tableSlots.get(id) ?? this.lingerTable.get(id);
        if (!slot) {
          prevSlots ??= this.computeTableSlots([...prevTable]);
          slot = prevSlots.get(id);
        }
        if (!slot) continue;
        this.lingerTable.set(id, { ...slot });
        this.lingerHold.add(id);
      }
      // 减员或有新牌入桌：冻结旧牌落点，回合结束再压实（避免中途重排）
      if (leftTable || hasArrival) this.beginTableLayoutFreeze(prevTable);
      if (this.tableLayoutFreeze) {
        for (const id of old) {
          if (!neu.has(id)) this.tableLayoutFreeze.delete(id);
        }
        for (const id of nextTable) {
          if (this.lingerHold.has(id)) continue;
          this.ensureFrozenSlot(id);
        }
      }
    }
    const prevPending = prev.pendingStockCard;
    const nextPending = next.pendingStockCard;
    if (
      typeof prevPending === "number" &&
      prevPending >= 0 &&
      prevPending !== nextPending
    ) {
      const onTable = new Set(next.table as number[]);
      if (!onTable.has(prevPending)) {
        const slot = this.tableSlots.get(prevPending) ??
          this.lingerTable.get(prevPending) ?? {
            x: this.w / 2 - TABLE_CARD_W / 2,
            y: 118,
            w: TABLE_CARD_W,
          };
        this.lingerTable.set(prevPending, { ...slot });
        this.lingerHold.add(prevPending);
      }
    }
    if (
      typeof nextPending === "number" &&
      nextPending >= 0 &&
      nextPending !== prevPending
    ) {
      this.deferredReveal.add(nextPending);
    }
  }

  /** 桌面明牌区：顶部给对手面板留白，避免与桌面牌重叠 */
  private get area() {
    return { x: 236, y: 168, w: this.w - 472, h: 280 };
  }

  /**
   * 全屏视口：只用 window，不读 canvas.clientWidth。
   * 安卓设置 canvas.width 后 clientWidth 会变成缓冲像素宽，再参与布局会错乱。
   */
  private viewportCssSize(): { cw: number; ch: number } {
    const cw = Math.max(1, window.innerWidth || document.documentElement.clientWidth);
    const ch = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
    return { cw, ch };
  }

  private updateLayout(): void {
    const dpr = window.devicePixelRatio || 1;
    const { cw, ch } = this.viewportCssSize();
    if (cw < 80 || ch < 80) return;
    this.viewCw = cw;
    this.viewCh = ch;

    const bufW = Math.max(1, Math.round(cw * dpr));
    const bufH = Math.max(1, Math.round(ch * dpr));
    if (
      bufW !== this.layoutBufW ||
      bufH !== this.layoutBufH ||
      dpr !== this.layoutDpr
    ) {
      this.canvas.width = bufW;
      this.canvas.height = bufH;
      this.layoutBufW = bufW;
      this.layoutBufH = bufH;
      this.layoutDpr = dpr;
    }
    // 安卓改 buffer 后常丢掉 CSS 尺寸与 transform；每帧强制钉回
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.rotated = shouldRotate();
    const vw = this.rotated ? ch : cw;
    const vh = this.rotated ? cw : ch;

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

  private pointerPos(e: PointerEvent): { x: number; y: number } {
    const cw = this.viewCw || window.innerWidth;
    const ch = this.viewCh || window.innerHeight;
    // 全屏 canvas：用窗口坐标，避免 getBoundingClientRect 被安卓缩成缓冲尺寸
    let sx = e.clientX;
    let sy = e.clientY;
    if (this.rotated) [sx, sy] = [sy, cw - sx];
    return {
      x: (sx - this.pad.x) / this.scale,
      y: (sy - this.pad.y) / this.scale,
    };
  }

  private onPointer(e: PointerEvent): void {
    this.updateLayout();
    const { x, y } = this.pointerPos(e);

    // 已吃详情随时可开合，优先于出牌点击
    if (this.capturedCloseHit) {
      const h = this.capturedCloseHit;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        this.showCaptured = false;
        return;
      }
    }
    if (this.capturedStackHit) {
      const h = this.capturedStackHit;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        this.cb.onToggleCaptured?.();
        return;
      }
    }
    if (this.showCaptured) {
      this.showCaptured = false;
      return;
    }

    if (this.animating) return;

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
        // events 可能早于 state：弃牌入桌也先冻结，避免旧牌被提前重排
        if (!(ev.type === "FLIP" && ev.awaitChoice))
          this.beginTableLayoutFreeze();
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
              dur: fromStock ? 0.32 : 0.24,
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
      else if (!this.lingerTable.has(ev.target))
        this.lingerTable.set(ev.target, {
          x: targetSlot.x,
          y: targetSlot.y,
          w: TABLE_CARD_W,
        });
      // 命中/MATCH 前始终暂留，避免 prune 在动画间隙把目标牌清掉
      this.lingerHold.add(ev.target);
      // events 可能早于 state：吃牌一开始就冻结落点，避免其余牌先挤位
      this.beginTableLayoutFreeze();
      this.tableLayoutFreeze!.delete(ev.target);
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
            dur: fromStock ? 0.32 : 0.22,
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
            dur: 0.22,
            faceUp: true,
          },
          {
            id: ev.card,
            from: hitSlot,
            to: { x: centerX - matchW - 10, y: centerY },
            w: matchW,
            t: 0,
            dur: 0.22,
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
            dur: 0.28,
            faceUp: true,
          },
          {
            id: ev.card,
            from: { x: centerX - matchW - 10, y: centerY },
            to: pile,
            w: TABLE_CARD_W,
            t: 0,
            dur: 0.28,
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
    this.drainAnimBacklog();
  }

  /** 动画积压过多时快进，避免长时间卡在「出牌结算中」 */
  private drainAnimBacklog(): void {
    if (this.steps.length < MAX_ANIM_STEPS) return;
    if (this.current) {
      for (const f of this.current.flies) f.t = f.dur;
      this.current.hold = 0;
    }
    for (const step of this.steps) {
      for (const f of step.flies) f.t = f.dur;
      step.hold = 0;
    }
  }

  private pruneLingerTable(table: number[]): void {
    const onTable = new Set(table);
    const busy = new Set<number>();
    const mark = (id: number) => {
      if (id >= 0) busy.add(id);
    };
    if (this.current) {
      for (const f of this.current.flies) mark(f.id);
      for (const id of this.current.hide ?? []) mark(id);
    }
    for (const step of this.steps) {
      for (const f of step.flies) mark(f.id);
      for (const id of step.hide ?? []) mark(id);
    }
    for (const id of [...this.lingerTable.keys()]) {
      if (!onTable.has(id) && !busy.has(id) && !this.lingerHold.has(id))
        this.lingerTable.delete(id);
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
    if (this.openingDeal) return 0;
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
    return this.current !== null || this.steps.length > 0 || this.openingDeal;
  }

  /** 轮末结算前：飞牌/暂留/未揭晓/未压实都算未完成 */
  get settleBusy(): boolean {
    if (this.animating || this.lingerHold.size || this.lingerTable.size)
      return true;
    if (this.tableLayoutFreeze) return true;
    const table = this.state?.table as number[] | undefined;
    if (table?.some((id) => this.deferredReveal.has(id))) return true;
    const pending = this.state?.pendingStockCard;
    return typeof pending === "number" && pending >= 0;
  }

  /** 新一轮开始时清掉未提交的显示延迟 */
  resetAnimVisuals(): void {
    this.steps.length = 0;
    this.current = null;
    this.hidden.clear();
    this.deferredReveal.clear();
    this.lingerTable.clear();
    this.lingerHold.clear();
    this.tableLayoutFreeze = null;
    this.stockAnimCredit = 0;
    this.pendingGain.clear();
    this.pendingCards.clear();
    this.pendingHand.clear();
    this.visualTurnSeat = null;
    this.openingDeal = false;
    this.dealArmed = false;
  }

  /** 开局发牌前先藏牌，等状态与手牌就绪再播动画 */
  prepDealAnim(): void {
    this.openingDeal = true;
    this.dealArmed = true;
    this.hideAllDealtCards();
  }

  tryDealAnim(): boolean {
    if (!this.dealArmed) return false;
    if (!this.state || this.state.phase !== "PLAYING") return false;
    if (!this.hand.length) return false;
    return this.startDealAnim();
  }

  /** 状态与手牌更新后重新藏牌（发牌动画启动前） */
  syncDealHidden(): void {
    if (!this.dealArmed && !this.openingDeal) return;
    this.hideAllDealtCards();
  }

  private hideAllDealtCards(): void {
    for (const id of this.hand) this.deferredReveal.add(id);
    const table: number[] = this.state?.table ? [...this.state.table] : [];
    for (const id of table) this.deferredReveal.add(id);
  }

  /** 新一轮：洗牌 + 逐轮发手牌 + 桌面开牌 */
  startDealAnim(): boolean {
    if (!this.dealArmed) return false;
    if (!this.state || this.state.phase !== "PLAYING") return false;
    if (!this.hand.length) return false;
    this.dealArmed = false;
    this.openingDeal = true;
    const count = this.state.players.size as number;
    const handSize = this.hand.length;
    const table: number[] = [...this.state.table];
    const deckFrom = { x: DECK.x, y: DECK.y };
    const allIds = [...this.hand, ...table];
    for (const id of allIds) this.deferredReveal.add(id);

    this.steps.push({
      flies: [],
      popups: [
        {
          text: "洗牌中…",
          at: { x: this.w / 2, y: H * 0.42 },
          t: 0,
          hint: true,
        },
      ],
      hide: allIds,
      hold: DEAL_SHUFFLE_S,
      dealSfx: "shuffle",
    });

    for (let r = 0; r < handSize; r++) {
      const flies: Fly[] = [];
      const hide: number[] = [];
      const reveal: number[] = [];
      for (let seat = 0; seat < count; seat++) {
        if (seat === this.mySeat) {
          const id = this.hand[r];
          const to = this.handSlotAt(r, handSize);
          flies.push({
            id,
            from: deckFrom,
            to,
            w: HAND_W,
            t: 0,
            dur: DEAL_FLY_S,
            faceUp: false,
            flip: true,
          });
          hide.push(id);
          reveal.push(id);
        } else {
          const to = this.panelPos(seat);
          flies.push({
            id: 0,
            from: deckFrom,
            to: {
              x: to.x + ((r % 3) - 1) * 4,
              y: to.y - Math.floor(r / 3) * 3,
            },
            w: 52,
            t: 0,
            dur: DEAL_FLY_S,
            faceUp: false,
          });
        }
      }
      this.steps.push({
        flies,
        popups: [],
        hide,
        hold: DEAL_ROUND_PAUSE_S,
        revealOnDone: reveal,
        dealSfx: "round",
      });
    }

    if (table.length) {
      const slots = this.computeTableSlots(table);
      const flies: Fly[] = table.map((id) => {
        const s = slots.get(id)!;
        return {
          id,
          from: deckFrom,
          to: { x: s.x, y: s.y },
          w: TABLE_CARD_W,
          t: 0,
          dur: DEAL_FLY_S,
          faceUp: false,
          flip: true,
        };
      });
      this.steps.push({
        flies,
        popups: [
          {
            text: "开牌",
            at: { x: this.w / 2, y: this.area.y - 22 },
            t: 0,
            hint: true,
          },
        ],
        hide: table,
        hold: DEAL_TABLE_PAUSE_S,
        revealOnDone: table,
        dealSfx: "table",
      });
    }

    this.steps.push({ flies: [], popups: [], hide: [], hold: 0.05 });
    return true;
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
        for (const id of this.current.clearLinger) {
          this.lingerTable.delete(id);
          this.lingerHold.delete(id);
        }
      }
      if (this.current.decStock)
        this.stockAnimCredit = Math.max(0, this.stockAnimCredit - 1);
      if (this.current.dealSfx)
        this.cb.onDealSfx?.(this.current.dealSfx);
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
      if (!this.steps.length) {
        this.visualTurnSeat = null;
        if (this.openingDeal) this.openingDeal = false;
        this.releaseTableLayoutFreeze();
      }
    }
  }

  private beginTableLayoutFreeze(prevTable?: number[]): void {
    if (this.tableLayoutFreeze) return;
    this.tableLayoutFreeze = new Map();
    for (const [id, s] of this.tableSlots)
      this.tableLayoutFreeze.set(id, { ...s });
    if (prevTable?.length && this.tableLayoutFreeze.size < prevTable.length) {
      for (const [id, s] of this.computeTableSlots([...prevTable])) {
        if (!this.tableLayoutFreeze.has(id))
          this.tableLayoutFreeze.set(id, { ...s });
      }
    }
  }

  private ensureFrozenSlot(id: number): Slot {
    const freeze = this.tableLayoutFreeze!;
    const existing = freeze.get(id);
    if (existing) return existing;
    const slot = this.nextFrozenAppendSlot();
    freeze.set(id, slot);
    return slot;
  }

  private nextFrozenAppendSlot(): Slot {
    const gap = 12;
    const w = TABLE_CARD_W;
    const rowH = w * CARD_RATIO + gap;
    const area = this.area;
    const occupied = this.tableLayoutFreeze
      ? [...this.tableLayoutFreeze.values()]
      : [];
    if (!occupied.length) return this.computeSlotAt(0, 1);
    let anchor = occupied[0];
    let left = occupied[0].x;
    for (const s of occupied) {
      if (s.x < left) left = s.x;
      if (s.y > anchor.y + 1 || (Math.abs(s.y - anchor.y) < 1 && s.x > anchor.x))
        anchor = s;
    }
    let x = anchor.x + w + gap;
    let y = anchor.y;
    if (x + w > area.x + area.w) {
      x = left;
      y = anchor.y + rowH;
    }
    return { x, y, w };
  }

  private tableFreezeBusy(): boolean {
    if (this.animating || this.lingerHold.size || this.lingerTable.size)
      return true;
    if (this.state?.turnPhase === "CHOOSE_STOCK_TARGET") return true;
    const pending = this.state?.pendingStockCard;
    if (typeof pending === "number" && pending >= 0) return true;
    const table = this.state?.table as number[] | undefined;
    return !!table?.some((id) => this.deferredReveal.has(id));
  }

  /** 回合动作全部结束后再压实填空隙 */
  private releaseTableLayoutFreeze(): void {
    if (!this.tableLayoutFreeze || this.tableFreezeBusy()) return;
    this.tableLayoutFreeze = null;
  }

  render(dt: number): void {
    this.updateLayout();
    const cw = this.viewCw;
    const ch = this.viewCh;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = C.feltOuter;
    ctx.fillRect(0, 0, cw, ch);
    if (this.rotated) {
      ctx.translate(cw, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.translate(this.pad.x, this.pad.y);
    ctx.scale(this.scale, this.scale);

    this.stepAnim(dt);
    this.drawFelt(ctx);
    const showBoard =
      this.state?.phase === "PLAYING" ||
      this.animating ||
      this.openingDeal ||
      this.roundEnding;
    if (showBoard) {
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
    if (this.tableLayoutFreeze)
      return { ...this.ensureFrozenSlot(cardId) };
    const slots = this.computeTableSlots([...this.state.table]);
    return slots.get(cardId) ?? null;
  }

  private computeSlotAt(index: number, count: number): Slot {
    const n = Math.max(1, count);
    const cols = Math.min(9, Math.max(1, n));
    const gap = 12;
    const rows = Math.ceil(n / cols);
    const rowH = TABLE_CARD_W * CARD_RATIO + gap;
    const area = this.area;
    const startY = area.y + (area.h - rows * rowH + gap) / 2;
    const row = Math.floor(index / cols);
    const inRow = Math.min(cols, n - row * cols);
    const rowW = inRow * TABLE_CARD_W + (inRow - 1) * gap;
    const startX = area.x + (area.w - rowW) / 2;
    return {
      x: startX + (index % cols) * (TABLE_CARD_W + gap),
      y: startY + row * rowH,
      w: TABLE_CARD_W,
    };
  }

  private computeTableSlots(table: number[]): Map<number, Slot> {
    const slots = new Map<number, Slot>();
    if (!table.length) return slots;
    table.forEach((id, i) => {
      slots.set(id, this.computeSlotAt(i, table.length));
    });
    return slots;
  }

  private layout(): void {
    const table: number[] = [...this.state.table].filter(
      (id) => !this.deferredReveal.has(id) && !this.lingerHold.has(id)
    );
    this.pruneLingerTable(table);
    this.releaseTableLayoutFreeze();
    if (this.tableLayoutFreeze) {
      this.tableSlots.clear();
      for (const id of table)
        this.tableSlots.set(id, { ...this.ensureFrozenSlot(id) });
    } else {
      this.tableSlots = this.computeTableSlots(table);
    }

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
    for (let seat = 0; seat < count; seat++) {
      this.pilePos.set(
        seat,
        seat === this.mySeat ? this.myCapturedPileOrigin() : this.panelPos(seat)
      );
    }
  }

  /** 自己已吃牌堆原点（左下角，避开用户信息） */
  private myCapturedPileOrigin(): Pt {
    const cardH = 54 * CARD_RATIO;
    return { x: 18, y: H - cardH - 14 };
  }

  private handSlotAt(i: number, n: number): Pt {
    const maxW = this.w - 200;
    const step = Math.min(HAND_W + 10, maxW / n);
    const totalW = step * (n - 1) + HAND_W;
    const startX = (this.w - totalW) / 2;
    const baseY = H - HAND_W * CARD_RATIO - 30;
    const k = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
    return { x: startX + i * step, y: baseY + k * k * 10 };
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
    const tid = currentThemeId();
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

    const felt = themeFeltImg(tid);
    if (felt) {
      ctx.save();
      ctx.globalAlpha =
        tid === "anime" ? 0.72 : tid === "mohong" ? 0.7 : 0.62;
      const pat = ctx.createPattern(felt, "repeat");
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }

    if (tid === "anime") {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = C.gold;
      for (let i = 0; i < 16; i++) {
        const px = 80 + ((i * 137) % (W - 160));
        const py = 90 + ((i * 97) % (H - 180));
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
          const ang = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
          const r = 10 + (i % 3) * 3;
          const nx = px + Math.cos(ang) * r;
          const ny = py + Math.sin(ang) * r;
          if (k === 0) ctx.moveTo(nx, ny);
          else ctx.lineTo(nx, ny);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (tid === "mohong") {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = C.seal;
      for (let i = 0; i < 6; i++) {
        const px = 100 + ((i * 173) % (W - 200));
        const py = 120 + ((i * 113) % (H - 220));
        const s = 18 + (i % 3) * 4;
        ctx.fillRect(px, py, s, s);
      }
      ctx.restore();
    }

    const radius = tid === "anime" ? 28 : tid === "mohong" ? 12 : 18;
    ctx.strokeStyle = `${C.gold}55`;
    ctx.lineWidth = 2;
    roundRect(ctx, 26, 26, W - 52, H - 52, radius);
    ctx.stroke();
    ctx.strokeStyle = `${C.gold}90`;
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

    ctx.save();
    ctx.globalAlpha = tid === "anime" ? 0.08 : 0.06;
    ctx.fillStyle = C.gold;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font =
      tid === "anime"
        ? `700 110px "PingFang SC", "Helvetica Neue", sans-serif`
        : `700 130px "Songti SC", "STSong", serif`;
    ctx.fillText("捡红点", W / 2, 500);
    ctx.restore();
  }

  private drawDeck(ctx: CanvasRenderingContext2D): void {
    const n = this.openingDeal
      ? Math.min(4, DECK_SIZE)
      : (this.state.stockCount as number) + this.stockAnimCredit;
    const shuffling =
      this.openingDeal &&
      this.current &&
      !this.current.flies.length &&
      this.current.popups.some((p) => p.hint);
    const shake = shuffling ? Math.sin(this.animClock * 16) * 5 : 0;
    const sway = shuffling ? Math.cos(this.animClock * 11) * 3 : 0;
    for (let i = Math.min(4, n) - 1; i >= 0; i--)
      drawCard(ctx, 0, DECK.x + i * 2 + shake, DECK.y - i * 2 + sway, DECK.w, {
        faceUp: false,
      });
    ctx.fillStyle = C.cream;
    ctx.textAlign = "center";
    ctx.font = `600 20px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(
      this.openingDeal ? "洗牌发牌" : `牌堆 ${n}`,
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
      if (this.hidden.has(id) || this.deferredReveal.has(id)) continue;
      drawCard(ctx, id, s.x, s.y, s.w, {
        selected: this.selected === id && this.discardArmed !== id && myTurn,
        discard: this.discardArmed === id && myTurn,
        dim: !myTurn,
      });
    }
    this.drawCaptured(ctx);
  }

  /** 自己的已吃牌堆：小堆叠 + 常驻入口，随时点开底部详情 */
  private drawCaptured(ctx: CanvasRenderingContext2D): void {
    this.capturedStackHit = null;
    this.capturedCloseHit = null;
    if (!this.state) return;
    const me = [...this.state.players.values()].find(
      (p: any) => p.seat === this.mySeat
    ) as any;
    if (!me) return;
    const stackCards = this.displayCaptured(me);
    const detailCards: number[] = me.captured ? [...me.captured] : [];
    const origin = this.myCapturedPileOrigin();
    const cw = 54;
    const ch = cw * CARD_RATIO;
    const step = Math.min(
      3.2,
      28 / Math.max(1, stackCards.length - 1 || 1)
    );
    const stackW =
      stackCards.length > 0 ? cw + (stackCards.length - 1) * step : cw;
    const stackH =
      stackCards.length > 0 ? ch + (stackCards.length - 1) * step : ch;
    const stackY =
      stackCards.length > 0
        ? origin.y - (stackCards.length - 1) * step
        : origin.y;
    const hitPad = 10;
    this.capturedStackHit = {
      x: origin.x - hitPad,
      y: stackY - 28 - hitPad,
      w: Math.max(stackW, 72) + hitPad * 2,
      h: stackH + 28 + hitPad * 2,
    };
    if (stackCards.length) {
      stackCards.forEach((id, i) => {
        drawCard(ctx, id, origin.x + i * step, origin.y - i * step, cw);
      });
    } else {
      ctx.save();
      roundRect(ctx, origin.x, origin.y, cw, ch, 6);
      ctx.strokeStyle = "rgba(201,169,97,0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    roundRect(ctx, origin.x, stackY - 26, 64, 22, 11);
    ctx.fillStyle = this.showCaptured
      ? "rgba(184,53,43,0.92)"
      : "rgba(8,26,20,0.82)";
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = C.cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 12px "Songti SC", serif`;
    ctx.fillText(`已吃 ${detailCards.length}`, origin.x + 32, stackY - 15);
    ctx.restore();

    if (!this.showCaptured) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const tw = coarse ? 72 : 88;
    const gap = 8;
    const panelW = Math.min(this.w * 0.92, this.w - 24);
    const innerPad = 14;
    const cols = Math.max(
      1,
      Math.min(
        Math.max(1, detailCards.length),
        Math.floor((panelW - innerPad * 2) / (tw + gap))
      )
    );
    const rows = Math.max(1, Math.ceil(detailCards.length / cols));
    const panelH = Math.min(
      H * 0.55,
      Math.max(
        120,
        rows * (tw * CARD_RATIO + gap) + innerPad * 2 + 40
      )
    );
    const px = (this.w - panelW) / 2;
    const py = H - panelH - 12;
    const closeSize = 32;
    this.capturedCloseHit = {
      x: px + panelW - closeSize - 8,
      y: py + 8,
      w: closeSize,
      h: closeSize,
    };
    ctx.save();
    roundRect(ctx, px, py, panelW, panelH, 12);
    ctx.fillStyle = "rgba(8,26,20,0.94)";
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 14px "Songti SC", serif`;
    ctx.fillText("已吃牌", px + panelW / 2, py + 22);
    ctx.fillStyle = "rgba(243, 234, 214, 0.75)";
    ctx.font = `600 22px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(
      "×",
      this.capturedCloseHit.x + closeSize / 2,
      this.capturedCloseHit.y + closeSize / 2
    );
    if (!detailCards.length) {
      ctx.fillStyle = "rgba(243,234,214,0.65)";
      ctx.font = `600 15px "Songti SC", serif`;
      ctx.fillText("暂无已吃牌", px + panelW / 2, py + panelH / 2 + 8);
    } else {
      detailCards.forEach((id, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        drawCard(
          ctx,
          id,
          px + innerPad + col * (tw + gap),
          py + 40 + row * (tw * CARD_RATIO + gap),
          tw
        );
      });
    }
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
