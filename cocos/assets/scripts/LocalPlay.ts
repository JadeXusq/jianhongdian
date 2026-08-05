/**
 * Cocos 离线人机：不依赖 Colyseus，规则与 AI 用同步后的 rules/。
 * 逻辑与 client/src/localPlay.ts 对齐。
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
} from "./rules";

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
  private playerCount: number;
  private totalRounds: number;
  private round = 0;
  private totals: number[] = [];

  onState?: (state: LocalState) => void;
  onEvents?: (events: GameEvent[]) => void;
  onRoundStart?: () => void;
  onRoundOver?: (r: LocalRoundOver) => void;

  constructor(
    humanName: string,
    difficulty: AiDifficulty = "normal",
    totalRounds = 5,
    playerCount = 2
  ) {
    this.humanName = humanName;
    this.aiName =
      difficulty === "hard"
        ? "电脑·难"
        : difficulty === "easy"
          ? "电脑·易"
          : "电脑";
    this.difficulty = difficulty;
    this.playerCount = Math.min(4, Math.max(2, Math.floor(playerCount) || 2));
    this.totalRounds = Math.min(20, Math.max(1, totalRounds));
    this.totals = Array.from({ length: this.playerCount }, () => 0);
    this.state = this.emptyState();
  }

  start(): void {
    this.round = 0;
    this.totals = Array.from({ length: this.playerCount }, () => 0);
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

  continueRound(): void {
    if (this.round >= this.totalRounds) {
      this.start();
      return;
    }
    this.nextRound();
  }

  private aiId(seat: number): string {
    return `local-ai-${seat}`;
  }

  private emptyState(): LocalState {
    return {
      phase: "WAITING",
      code: "练习",
      hostSessionId: HUMAN,
      maxPlayers: this.playerCount,
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
    this.game = new Game(this.playerCount);
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
    for (let i = 0; i < this.playerCount; i++) this.totals[i] += result.net[i];
    const allDone = this.round >= this.totalRounds;
    this.state.phase = "ROUND_OVER";
    this.syncFromGame();
    this.state.phase = "ROUND_OVER";
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
    this.aiTimer = setTimeout(() => this.aiAct(), wait) as unknown as number;
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
    for (let seat = 1; seat < this.playerCount; seat++) {
      const id = this.aiId(seat);
      const label =
        this.playerCount > 2 ? `${this.aiName}${seat}` : this.aiName;
      players.set(id, {
        sessionId: id,
        name: label,
        seat,
        isAi: true,
        connected: true,
        ready: true,
        points: g.players[seat].captured.reduce(
          (s, cid) => s + cardScore(cid),
          0
        ),
        handCount: g.players[seat].hand.length,
        captured: [...g.players[seat].captured],
        totalNet: this.totals[seat],
      });
    }
    this.state.players = players;
    this.state.maxPlayers = this.playerCount;
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
