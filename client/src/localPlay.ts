/**
 * 浏览器内离线人机：不依赖 Colyseus，规则与 AI 直接用 shared。
 * 状态形态对齐 TableView 所需字段，便于复用牌桌渲染。
 */
import {
  AI_DELAY_MS,
  bestTarget,
  captureAnimMs,
  cardScore,
  chooseHandPlay,
  discardAnimMs,
  Game,
  type AiDifficulty,
  type GameEvent,
} from "@jhd/shared";

export interface LocalPlayer {
  sessionId: string;
  name: string;
  seat: number;
  isAi: boolean;
  connected: boolean;
  ready: boolean;
  points: number;
  handCount: number;
  captured: number[];
  totalNet: number;
}

export interface LocalState {
  phase: "WAITING" | "PLAYING" | "ROUND_OVER";
  code: string;
  hostSessionId: string;
  maxPlayers: number;
  totalRounds: number;
  round: number;
  table: number[];
  stockCount: number;
  currentSeat: number;
  turnPhase: "PLAY_HAND" | "CHOOSE_STOCK_TARGET" | "FINISHED";
  pendingStockCard: number;
  turnDeadline: number;
  players: Map<string, LocalPlayer>;
}

export interface LocalRoundOver {
  points: number[];
  net: number[];
  base: number;
  round: number;
  totalRounds: number;
  allDone: boolean;
}

const HUMAN = "local-human";
const AI = "local-ai";

export class LocalPlay {
  game: Game | null = null;
  state: LocalState;
  hand: number[] = [];
  mySeat = 0;
  readonly humanId = HUMAN;
  private aiTimer = 0;
  private difficulty: AiDifficulty;
  private humanName: string;
  private aiName: string;
  private totalRounds: number;
  private round = 0;
  private totals: number[] = [0, 0];

  onState?: (state: LocalState) => void;
  onEvents?: (events: GameEvent[]) => void;
  onRoundStart?: () => void;
  onRoundOver?: (r: LocalRoundOver) => void;

  constructor(
    humanName: string,
    difficulty: AiDifficulty = "normal",
    totalRounds = 5
  ) {
    this.humanName = humanName;
    this.aiName = difficulty === "hard" ? "电脑·难" : difficulty === "easy" ? "电脑·易" : "电脑";
    this.difficulty = difficulty;
    this.totalRounds = Math.min(20, Math.max(1, totalRounds));
    this.state = this.emptyState();
  }

  start(): void {
    this.round = 0;
    this.totals = [0, 0];
    this.nextRound();
  }

  stop(): void {
    clearTimeout(this.aiTimer);
    this.aiTimer = 0;
    this.game = null;
  }

  play(cardId: number, targetId?: number): void {
    const g = this.game;
    if (!g || g.phase !== "PLAY_HAND" || g.currentPlayer !== this.mySeat)
      return;
    const events = g.playHandCard(this.mySeat, cardId, targetId);
    this.afterMove(events);
  }

  chooseTarget(targetId: number): void {
    const g = this.game;
    if (
      !g ||
      g.phase !== "CHOOSE_STOCK_TARGET" ||
      g.currentPlayer !== this.mySeat
    )
      return;
    const events = g.chooseStockTarget(this.mySeat, targetId);
    this.afterMove(events);
  }

  private emptyState(): LocalState {
    return {
      phase: "WAITING",
      code: "练习",
      hostSessionId: HUMAN,
      maxPlayers: 2,
      totalRounds: this.totalRounds,
      round: 0,
      table: [],
      stockCount: 0,
      currentSeat: -1,
      turnPhase: "PLAY_HAND",
      pendingStockCard: -1,
      turnDeadline: 0,
      players: new Map(),
    };
  }

  private nextRound(): void {
    clearTimeout(this.aiTimer);
    this.game = new Game(2);
    this.round += 1;
    this.syncFromGame();
    this.state.phase = "PLAYING";
    this.state.round = this.round;
    this.emitState();
    this.onRoundStart?.();
    this.scheduleAi(0);
  }

  private afterMove(events: GameEvent[]): void {
    if (events.length) this.onEvents?.(events);
    this.syncFromGame();
    this.emitState();
    if (this.game!.phase === "FINISHED") {
      this.endRound();
      return;
    }
    const pad = events.reduce(
      (s, e) =>
        s + (e.target === undefined ? discardAnimMs() : captureAnimMs()),
      0
    );
    this.scheduleAi(pad);
  }

  private endRound(): void {
    clearTimeout(this.aiTimer);
    const result = this.game!.result();
    this.totals[0] += result.net[0];
    this.totals[1] += result.net[1];
    const allDone = this.round >= this.totalRounds;
    this.state.phase = "ROUND_OVER";
    const human = this.state.players.get(HUMAN)!;
    const ai = this.state.players.get(AI)!;
    human.totalNet = this.totals[0];
    ai.totalNet = this.totals[1];
    human.points = result.points[0];
    ai.points = result.points[1];
    this.emitState();
    this.onRoundOver?.({
      points: result.points,
      net: result.net,
      base: result.base,
      round: this.round,
      totalRounds: this.totalRounds,
      allDone,
    });
  }

  /** 结算后继续下一轮（未打满时） */
  continueRound(): void {
    if (this.round >= this.totalRounds) {
      this.start();
      return;
    }
    this.nextRound();
  }

  private scheduleAi(animPadMs: number): void {
    clearTimeout(this.aiTimer);
    const g = this.game;
    if (!g || g.phase === "FINISHED") return;
    if (g.currentPlayer === this.mySeat) {
      this.state.turnDeadline = Date.now() + 60_000;
      this.emitState();
      return;
    }
    const wait = AI_DELAY_MS + animPadMs;
    this.state.turnDeadline = Date.now() + wait;
    this.emitState();
    this.aiTimer = window.setTimeout(() => this.aiAct(), wait);
  }

  private aiAct(): void {
    const g = this.game;
    if (!g || g.phase === "FINISHED") return;
    if (g.currentPlayer === this.mySeat) return;
    const seat = g.currentPlayer;
    let events: GameEvent[];
    if (g.phase === "CHOOSE_STOCK_TARGET") {
      events = g.chooseStockTarget(
        seat,
        bestTarget(g.stockTargets(), this.difficulty)
      );
    } else {
      const move = chooseHandPlay(
        g.players[seat].hand,
        [...g.table],
        this.difficulty
      );
      events = g.playHandCard(seat, move.cardId, move.targetId);
    }
    this.afterMove(events);
  }

  private syncFromGame(): void {
    const g = this.game!;
    const players = new Map<string, LocalPlayer>();
    players.set(HUMAN, {
      sessionId: HUMAN,
      name: this.humanName,
      seat: 0,
      isAi: false,
      connected: true,
      ready: true,
      points: g.players[0].captured.reduce((s, id) => s + cardScore(id), 0),
      handCount: g.players[0].hand.length,
      captured: [...g.players[0].captured],
      totalNet: this.totals[0],
    });
    players.set(AI, {
      sessionId: AI,
      name: this.aiName,
      seat: 1,
      isAi: true,
      connected: true,
      ready: true,
      points: g.players[1].captured.reduce((s, id) => s + cardScore(id), 0),
      handCount: g.players[1].hand.length,
      captured: [...g.players[1].captured],
      totalNet: this.totals[1],
    });
    this.state.players = players;
    this.state.table = [...g.table];
    this.state.stockCount = g.stock.length;
    this.state.currentSeat = g.currentPlayer;
    this.state.turnPhase =
      g.phase === "FINISHED" ? "PLAY_HAND" : (g.phase as any);
    this.state.pendingStockCard = g.pendingStockCard;
    this.hand = [...g.players[0].hand];
  }

  private emitState(): void {
    this.onState?.(this.state);
  }
}
