/**
 * 浏览器内离线人机：不依赖 Colyseus，规则与 AI 直接用 shared。
 * 状态形态对齐 TableView 所需字段，便于复用牌桌渲染。
 */
import {
  AI_DELAY_MS,
  TURN_MS,
  bestTarget,
  captureAnimMs,
  cardScore,
  chooseHandPlay,
  dealAnimMs,
  discardAnimMs,
  DEFAULT_THEME_ID,
  resolveThemeId,
  type ThemeId,
  Game,
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
  roundStarter: number;
  table: number[];
  stockCount: number;
  currentSeat: number;
  turnPhase: "PLAY_HAND" | "CHOOSE_STOCK_TARGET" | "FINISHED";
  pendingStockCard: number;
  turnDeadline: number;
  themeId: ThemeId;
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
  private humanName: string;
  private aiName = "机器人";
  private playerCount: number;
  private round = 0;
  private totals: number[] = [];
  private roundStarter = -1;
  private settleAfterRound = false;
  private matchClosed = false;

  onState?: (state: LocalState) => void;
  onEvents?: (events: GameEvent[]) => void;
  onRoundStart?: () => void;
  onRoundOver?: (r: LocalRoundOver) => void;
  /** 为 true 时 AI 延后出手（发牌/吃牌等动画未结束） */
  animBusy?: () => boolean;

  constructor(humanName: string, playerCount = 2) {
    this.humanName = humanName;
    this.playerCount = Math.min(4, Math.max(2, Math.floor(playerCount) || 2));
    this.totals = Array.from({ length: this.playerCount }, () => 0);
    this.state = this.emptyState();
  }

  start(): void {
    this.round = 0;
    this.roundStarter = -1;
    this.settleAfterRound = false;
    this.matchClosed = false;
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

  /** 本机玩家即房主：结算本场（人机立即结束，不等本轮） */
  endMatch(): { deferred: boolean } {
    if (this.matchClosed) return { deferred: false };
    clearTimeout(this.aiTimer);
    this.settleAfterRound = false;
    if (this.state.phase === "PLAYING" && this.game) {
      const base = 240 / this.playerCount;
      for (let i = 0; i < this.playerCount; i++) {
        const pts = this.game.players[i].captured.reduce(
          (s, id) => s + cardScore(id),
          0
        );
        this.totals[i] += pts - base;
      }
      this.game = null;
      this.closeMatch();
      return { deferred: false };
    }
    if (this.state.phase === "ROUND_OVER") {
      this.closeMatch();
      return { deferred: false };
    }
    return { deferred: false };
  }

  continueRound(): void {
    if (this.matchClosed) {
      this.start();
      return;
    }
    this.nextRound();
  }

  setTheme(themeId: string): void {
    this.state.themeId = resolveThemeId(themeId);
    this.emitState();
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
      totalRounds: 0,
      round: 0,
      roundStarter: -1,
      table: [],
      stockCount: 0,
      currentSeat: -1,
      turnPhase: "PLAY_HAND",
      pendingStockCard: -1,
      turnDeadline: 0,
      themeId: DEFAULT_THEME_ID,
      players: new Map(),
    };
  }

  private nextRound(): void {
    clearTimeout(this.aiTimer);
    if (this.roundStarter < 0) {
      this.roundStarter = Math.floor(Math.random() * this.playerCount);
    } else {
      this.roundStarter =
        (this.roundStarter - 1 + this.playerCount) % this.playerCount;
    }
    this.game = new Game(this.playerCount, Date.now(), this.roundStarter);
    this.round += 1;
    this.matchClosed = false;
    this.syncFromGame();
    this.state.phase = "PLAYING";
    this.state.round = this.round;
    this.state.roundStarter = this.roundStarter;
    this.onRoundStart?.();
    this.emitState();
    this.scheduleAi(dealAnimMs(this.playerCount));
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
    for (let i = 0; i < this.playerCount; i++)
      this.totals[i] += result.net[i];
    const allDone = this.settleAfterRound;
    this.settleAfterRound = false;
    if (allDone) this.matchClosed = true;
    this.state.phase = "ROUND_OVER";
    this.syncFromGame();
    this.state.phase = "ROUND_OVER";
    this.emitState();
    this.onRoundOver?.({
      points: result.points,
      net: result.net,
      base: result.base,
      round: this.round,
      totalRounds: allDone ? this.round : 0,
      allDone,
    });
  }

  private closeMatch(): void {
    this.matchClosed = true;
    this.settleAfterRound = false;
    this.state.phase = "ROUND_OVER";
    this.emitState();
    this.onRoundOver?.({
      points: [...this.totals],
      net: [...this.totals],
      base: 0,
      round: this.round,
      totalRounds: this.round,
      allDone: true,
    });
  }

  private scheduleAi(animPadMs: number): void {
    clearTimeout(this.aiTimer);
    const g = this.game;
    if (!g || g.phase === "FINISHED") return;
    if (g.currentPlayer === this.mySeat) {
      this.state.turnDeadline = Date.now() + TURN_MS;
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
    if (this.animBusy?.()) {
      this.aiTimer = window.setTimeout(() => this.aiAct(), 120);
      return;
    }
    const seat = g.currentPlayer;
    let events: GameEvent[];
    if (g.phase === "CHOOSE_STOCK_TARGET") {
      events = g.chooseStockTarget(seat, bestTarget(g.stockTargets()));
    } else {
      const move = chooseHandPlay(g.players[seat].hand, [...g.table]);
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
        this.playerCount === 2 ? this.aiName : `${this.aiName} ${seat}`;
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
    this.state.roundStarter = this.roundStarter;
    this.hand = [...g.players[0].hand];
  }

  private emitState(): void {
    this.onState?.(this.state);
  }
}
