/**
 * 捡红点 回合状态机（服务器权威，纯逻辑无 IO）
 *
 * 回合流程：出手牌（能配必吃，多目标自选）→ 翻牌堆（能配必吃，
 * 多目标进入选择阶段）→ 下一家。手牌与牌堆同时耗尽即终局。
 */
import {
  canPair,
  cardScore,
  createDeck,
  findTargets,
  INITIAL_TABLE_CARDS,
  TOTAL_HAND_CARDS,
  TOTAL_SCORE,
} from "./cards";
import { mulberry32, Rng, shuffle } from "./rng";

export type Phase = "PLAY_HAND" | "CHOOSE_STOCK_TARGET" | "FINISHED";

export interface PlayerState {
  hand: number[];
  /** 吃到的牌（含黑牌） */
  captured: number[];
}

export interface GameEvent {
  type: "PLAY" | "FLIP";
  player: number;
  card: number;
  /** 有值表示吃牌，无值表示留在桌面 */
  target?: number;
}

export interface GameResult {
  points: number[];
  base: number;
  net: number[];
}

export class RuleError extends Error {}

export class Game {
  readonly playerCount: number;
  readonly players: PlayerState[];
  table: number[] = [];
  stock: number[] = [];
  currentPlayer = 0;
  phase: Phase = "PLAY_HAND";
  /** CHOOSE_STOCK_TARGET 阶段等待选择目标的翻出牌 */
  pendingStockCard = -1;

  constructor(playerCount: number, seed = Date.now()) {
    if (playerCount < 2 || playerCount > 4) throw new RuleError("人数须为 2~4");
    this.playerCount = playerCount;
    this.players = Array.from({ length: playerCount }, () => ({
      hand: [],
      captured: [],
    }));
    this.deal(mulberry32(seed));
  }

  /** 发牌；若初始 6 张明牌存在可互相配对的则整副重洗 */
  private deal(rng: Rng): void {
    const handSize = TOTAL_HAND_CARDS / this.playerCount;
    for (;;) {
      const deck = shuffle(createDeck(), rng);
      const table = deck.slice(
        TOTAL_HAND_CARDS,
        TOTAL_HAND_CARDS + INITIAL_TABLE_CARDS
      );
      const hasPair = table.some((a, i) =>
        table.slice(i + 1).some((b) => canPair(a, b))
      );
      if (hasPair) continue;
      this.players.forEach((p, i) => {
        p.hand = deck.slice(i * handSize, (i + 1) * handSize);
      });
      this.table = table;
      this.stock = deck.slice(TOTAL_HAND_CARDS + INITIAL_TABLE_CARDS);
      return;
    }
  }

  /**
   * 当前玩家出一张手牌。桌面有可配对牌时必须吃（多目标须指明 targetId，
   * 唯一目标可省略）；无可配对牌时留在桌面。随后自动翻牌堆。
   * 返回本次产生的事件；若翻出的牌有多个目标，最后会停在 CHOOSE_STOCK_TARGET。
   */
  playHandCard(player: number, cardId: number, targetId?: number): GameEvent[] {
    this.assertTurn(player, "PLAY_HAND");
    const hand = this.players[player].hand;
    const idx = hand.indexOf(cardId);
    if (idx < 0) throw new RuleError("手牌中没有这张牌");

    const targets = findTargets(cardId, this.table);
    const events: GameEvent[] = [];
    if (targets.length > 0) {
      const target =
        targetId ?? (targets.length === 1 ? targets[0] : undefined);
      if (target === undefined)
        throw new RuleError("存在多个可吃目标，须指定其一");
      if (!targets.includes(target)) throw new RuleError("目标不可配对");
      hand.splice(idx, 1);
      this.capture(player, cardId, target);
      events.push({ type: "PLAY", player, card: cardId, target });
    } else {
      if (targetId !== undefined) throw new RuleError("无可配对目标");
      hand.splice(idx, 1);
      this.table.push(cardId);
      events.push({ type: "PLAY", player, card: cardId });
    }
    events.push(...this.flipStock(player));
    return events;
  }

  /** CHOOSE_STOCK_TARGET 阶段：为翻出的牌选定要吃的目标 */
  chooseStockTarget(player: number, targetId: number): GameEvent[] {
    this.assertTurn(player, "CHOOSE_STOCK_TARGET");
    const card = this.pendingStockCard;
    if (!findTargets(card, this.table).includes(targetId))
      throw new RuleError("目标不可配对");
    this.pendingStockCard = -1;
    this.capture(player, card, targetId);
    const events: GameEvent[] = [
      { type: "FLIP", player, card, target: targetId },
    ];
    this.endTurn();
    return events;
  }

  /** 翻出的牌当前的可吃目标（供客户端高亮/AI 决策） */
  stockTargets(): number[] {
    if (this.phase !== "CHOOSE_STOCK_TARGET") return [];
    return findTargets(this.pendingStockCard, this.table);
  }

  private flipStock(player: number): GameEvent[] {
    const card = this.stock.pop()!;
    const targets = findTargets(card, this.table);
    if (targets.length === 0) {
      this.table.push(card);
      this.endTurn();
      return [{ type: "FLIP", player, card }];
    }
    if (targets.length === 1) {
      this.capture(player, card, targets[0]);
      this.endTurn();
      return [{ type: "FLIP", player, card, target: targets[0] }];
    }
    this.pendingStockCard = card;
    this.phase = "CHOOSE_STOCK_TARGET";
    return [];
  }

  private capture(player: number, card: number, target: number): void {
    const ti = this.table.indexOf(target);
    if (ti < 0) throw new RuleError("目标不在桌面");
    this.table.splice(ti, 1);
    this.players[player].captured.push(card, target);
  }

  private endTurn(): void {
    if (this.players.every((p) => p.hand.length === 0)) {
      this.phase = "FINISHED";
      return;
    }
    this.currentPlayer = (this.currentPlayer + 1) % this.playerCount;
    this.phase = "PLAY_HAND";
  }

  private assertTurn(player: number, phase: Phase): void {
    if (this.phase !== phase) throw new RuleError(`当前阶段为 ${this.phase}`);
    if (this.currentPlayer !== player) throw new RuleError("未轮到该玩家");
  }

  /** 终局结算：得分 − 底分（240/人数） */
  result(): GameResult {
    if (this.phase !== "FINISHED") throw new RuleError("对局未结束");
    const points = this.players.map((p) =>
      p.captured.reduce((s, id) => s + cardScore(id), 0)
    );
    const base = TOTAL_SCORE / this.playerCount;
    return { points, base, net: points.map((v) => v - base) };
  }
}
