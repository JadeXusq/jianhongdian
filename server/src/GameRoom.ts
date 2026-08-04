/**
 * 捡红点对局房间（服务器权威）
 *
 * 职责：座位与准备、开局发牌、回合驱动与超时托管、AI 补位、
 * 断线重连、结算与累计净分。手牌只下发给本人，防止读取他人手牌。
 */
import { ArraySchema } from "@colyseus/schema";
import { Client, Room } from "colyseus";
import {
  bestTarget,
  chooseHandPlay,
  Game,
  GameEvent,
  RuleError,
  totalScore,
  TURN_MS,
  AI_DELAY_MS,
  RECONNECT_MS,
  parseAiDifficulty,
  type AiDifficulty,
} from "@jhd/shared";
import { registerCode, unregisterCode } from "./roomCodes";
import { recordResult } from "./store";
import { PlayerSchema, RoomState, TurnPhase } from "./state";

export interface JoinOptions {
  name?: string;
  avatar?: string;
  maxPlayers?: number;
  /** 总轮数（默认 5 轮）*/
  totalRounds?: number;
  /** 游客账号标识，用于战绩累计 */
  deviceId?: string;
  /** 本房 AI 默认难度 */
  aiDifficulty?: AiDifficulty;
  /** 以观战身份进入（不占座位、无手牌、不可操作） */
  spectate?: boolean;
}

export class GameRoom extends Room<RoomState> {
  private game: Game | null = null;
  /** seat → 手牌（私密） */
  private hands = new Map<number, number[]>();
  private turnTimer: { clear(): void } | null = null;
  private aiCounter = 0;
  /** 玩家 → 游客设备标识（不能用座位号做 key，座位会因压缩而变）*/
  private devices = new Map<PlayerSchema, string>();
  private defaultAiDifficulty: AiDifficulty = "normal";
  /** seat → AI 难度 */
  private aiLevels = new Map<number, AiDifficulty>();
  /** 观战者 sessionId */
  private spectators = new Set<string>();

  onCreate(options: JoinOptions): void {
    const maxPlayers = clampPlayers(options.maxPlayers ?? 4);
    this.maxClients = maxPlayers + 8;
    this.setState(new RoomState());
    this.state.maxPlayers = maxPlayers;
    this.state.totalRounds = Math.min(
      20,
      Math.max(1, options.totalRounds ?? 5)
    );
    this.defaultAiDifficulty = parseAiDifficulty(options.aiDifficulty);
    this.state.code = registerCode(this.roomId);
    this.setMetadata({ code: this.state.code, maxPlayers });

    this.onMessage("ready", (client, ready: boolean) =>
      this.onReady(client, ready)
    );
    this.onMessage(
      "addAi",
      (client, msg?: { difficulty?: AiDifficulty }) =>
        this.onAddAi(client, msg)
    );
    this.onMessage("removeAi", (client, seat: number) =>
      this.onRemoveAi(client, seat)
    );
    this.onMessage(
      "play",
      (client, msg: { cardId: number; targetId?: number }) =>
        this.onPlay(client, msg)
    );
    this.onMessage("chooseTarget", (client, msg: { targetId: number }) =>
      this.onChooseTarget(client, msg)
    );
    this.onMessage("nextRound", (client) => this.onNextRound(client));
    this.onMessage("emote", (client, msg: { id?: string }) =>
      this.onEmote(client, msg)
    );
  }

  onJoin(client: Client, options: JoinOptions): void {
    if (options.spectate) {
      this.spectators.add(client.sessionId);
      client.send("joined", {
        seat: -1,
        code: this.state.code,
        spectate: true,
      });
      return;
    }
    if (this.state.phase !== "WAITING") {
      throw new Error("对局已开始，请选择观战加入");
    }
    const seat = this.freeSeat();
    if (seat < 0) throw new Error("房间已满");
    const p = new PlayerSchema();
    p.sessionId = client.sessionId;
    p.seat = seat;
    p.name = (options.name || `玩家${seat + 1}`).slice(0, 12);
    p.avatar = options.avatar ?? "";
    if (options.deviceId) this.devices.set(p, options.deviceId);
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    client.send("joined", { seat, code: this.state.code, spectate: false });
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    if (this.spectators.has(client.sessionId)) {
      this.spectators.delete(client.sessionId);
      return;
    }
    const p = this.state.players.get(client.sessionId);
    if (!p) return;

    // 等待阶段直接离座；对局中保留座位，由 AI 临时托管
    if (this.state.phase === "WAITING" || consented) {
      this.state.players.delete(client.sessionId);
      this.reassignHost();
      return;
    }

    p.connected = false;
    this.driveIfAutoTurn();
    try {
      await this.allowReconnection(client, RECONNECT_MS / 1000);
      p.connected = true;
      p.sessionId = client.sessionId;
      this.sendHand(p.seat);
    } catch {
      p.isAi = true; // 超时未回：永久交给 AI，保证对局能打完
    }
  }

  onDispose(): void {
    unregisterCode(this.state.code);
  }

  // ---------- 等待阶段 ----------

  private onReady(client: Client, ready: boolean): void {
    if (this.state.phase === "PLAYING") return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = ready;
    this.startIfAllReady();
  }

  private onAddAi(
    client: Client,
    msg?: { difficulty?: AiDifficulty }
  ): void {
    if (!this.isHost(client) || this.state.phase === "PLAYING") return;
    const seat = this.freeSeat();
    if (seat < 0) return;
    const p = new PlayerSchema();
    p.sessionId = `ai:${++this.aiCounter}`;
    p.seat = seat;
    p.name = `电脑${seat + 1}`;
    p.isAi = true;
    p.ready = true;
    this.aiLevels.set(
      seat,
      parseAiDifficulty(msg?.difficulty ?? this.defaultAiDifficulty)
    );
    this.state.players.set(p.sessionId, p);
    this.startIfAllReady();
  }

  private onRemoveAi(client: Client, seat: number): void {
    if (!this.isHost(client) || this.state.phase === "PLAYING") return;
    const target = [...this.state.players.values()].find(
      (p) => p.seat === seat && p.isAi
    );
    if (target) {
      this.state.players.delete(target.sessionId);
      this.aiLevels.delete(seat);
    }
  }

  private startIfAllReady(): void {
    const players = [...this.state.players.values()];
    if (players.length !== this.state.maxPlayers) return;
    if (!players.every((p) => p.ready)) return;
    this.startRound();
  }

  private onNextRound(client: Client): void {
    if (this.state.phase !== "ROUND_OVER") return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = true;
    if ([...this.state.players.values()].every((x) => x.ready))
      this.startRound();
  }

  // ---------- 对局 ----------

  private startRound(): void {
    // 座位须为 0..n-1 连续，规则引擎以座位号作为玩家索引
    this.compactSeats();
    const count = this.state.players.size;
    this.game = new Game(count, Date.now());
    this.hands.clear();
    this.game.players.forEach((p, seat) => this.hands.set(seat, p.hand));

    this.state.phase = "PLAYING";
    this.state.round += 1;
    this.state.players.forEach((p) => {
      p.ready = false;
      p.points = 0;
      p.captured = new ArraySchema<number>();
    });
    this.syncGame();
    this.broadcast("roundStart", { round: this.state.round });
    this.state.players.forEach((p) => this.sendHand(p.seat));
    this.beginTurn();
  }

  private onPlay(
    client: Client,
    msg: { cardId: number; targetId?: number }
  ): void {
    const p = this.state.players.get(client.sessionId);
    if (!this.game || !p || this.state.phase !== "PLAYING") return;
    try {
      const events = this.game.playHandCard(p.seat, msg.cardId, msg.targetId);
      this.afterMove(events, p.seat);
    } catch (e) {
      if (e instanceof RuleError) client.send("error", { message: e.message });
      else throw e;
    }
  }

  private onChooseTarget(client: Client, msg: { targetId: number }): void {
    const p = this.state.players.get(client.sessionId);
    if (!this.game || !p || this.state.phase !== "PLAYING") return;
    try {
      const events = this.game.chooseStockTarget(p.seat, msg.targetId);
      this.afterMove(events, p.seat);
    } catch (e) {
      if (e instanceof RuleError) client.send("error", { message: e.message });
      else throw e;
    }
  }

  private afterMove(events: GameEvent[], seat: number): void {
    this.syncGame();
    this.sendHand(seat);
    if (events.length) this.broadcast("events", events);
    if (this.game!.phase === "FINISHED") this.endRound();
    else this.beginTurn();
  }

  /** 开启回合：设置倒计时；AI 或掉线玩家则安排自动出牌 */
  private beginTurn(): void {
    const g = this.game!;
    const seat = g.currentPlayer;
    const p = this.playerBySeat(seat);
    const auto = !p || p.isAi || !p.connected;
    const wait = auto ? AI_DELAY_MS : TURN_MS;

    this.state.currentSeat = seat;
    this.state.turnPhase = g.phase as TurnPhase;
    this.state.pendingStockCard = g.pendingStockCard;
    this.state.turnDeadline = Date.now() + wait;

    this.turnTimer?.clear();
    // 人类超时则由 AI 代打本回合，避免卡住整局
    this.turnTimer = this.clock.setTimeout(() => this.autoPlay(), wait);
  }

  /** 若当前回合属于 AI/掉线玩家，重新安排一次自动出牌 */
  private driveIfAutoTurn(): void {
    if (this.state.phase !== "PLAYING" || !this.game) return;
    const p = this.playerBySeat(this.game.currentPlayer);
    if (!p || p.isAi || !p.connected) this.beginTurn();
  }

  private autoPlay(): void {
    const g = this.game;
    if (!g || this.state.phase !== "PLAYING") return;
    const seat = g.currentPlayer;
    const diff =
      this.aiLevels.get(seat) ?? this.defaultAiDifficulty;
    if (g.phase === "CHOOSE_STOCK_TARGET") {
      this.afterMove(
        g.chooseStockTarget(seat, bestTarget(g.stockTargets(), diff)),
        seat
      );
      return;
    }
    const move = chooseHandPlay(g.players[seat].hand, [...g.table], diff);
    this.afterMove(g.playHandCard(seat, move.cardId, move.targetId), seat);
  }

  private endRound(): void {
    this.turnTimer?.clear();
    this.turnTimer = null;
    const result = this.game!.result();
    this.state.players.forEach((p) => {
      p.totalNet += result.net[p.seat];
      p.ready = false;
      const deviceId = this.devices.get(p);
      if (deviceId && !p.isAi)
        recordResult(deviceId, p.name, result.net[p.seat]);
    });
    this.state.phase = "ROUND_OVER";
    this.state.currentSeat = -1;
    this.state.turnDeadline = 0;
    const allDone = this.state.round >= this.state.totalRounds;
    this.broadcast("roundOver", {
      points: result.points,
      base: result.base,
      net: result.net,
      captured: this.game!.players.map((p) => p.captured),
      round: this.state.round,
      totalRounds: this.state.totalRounds,
      allDone,
    });
    // 未打满轮数：3 秒后自动开下一轮
    if (!allDone) {
      this.clock.setTimeout(() => {
        this.state.players.forEach((p) => (p.ready = true));
        this.startRound();
      }, 3000);
    }
  }

  // ---------- 同步 ----------

  private syncGame(): void {
    const g = this.game!;
    this.state.table = new ArraySchema<number>(...g.table);
    this.state.stockCount = g.stock.length;
    this.state.players.forEach((p) => {
      const gp = g.players[p.seat];
      p.handCount = gp.hand.length;
      p.points = totalScore(gp.captured);
      p.captured = new ArraySchema<number>(...gp.captured);
    });
  }

  private sendHand(seat: number): void {
    const p = this.playerBySeat(seat);
    if (!p || p.isAi || !p.connected || !this.game) return;
    const client = this.clients.find((c) => c.sessionId === p.sessionId);
    client?.send("hand", this.game.players[seat].hand);
  }

  // ---------- 互动 ----------

  private static readonly EMOTES = new Set([
    "加油",
    "好棋",
    "厉害",
    "等等",
    "哈哈哈",
  ]);

  private onEmote(client: Client, msg: { id?: string }): void {
    const text = (msg?.id || "").slice(0, 8);
    if (!GameRoom.EMOTES.has(text)) return;
    const p = this.state.players.get(client.sessionId);
    const name = p?.name ?? "观众";
    const seat = p?.seat ?? -1;
    this.broadcast("emote", { seat, name, id: text });
  }

  // ---------- 工具 ----------

  private playerBySeat(seat: number): PlayerSchema | undefined {
    return [...this.state.players.values()].find((p) => p.seat === seat);
  }

  private freeSeat(): number {
    const taken = new Set([...this.state.players.values()].map((p) => p.seat));
    for (let i = 0; i < this.state.maxPlayers; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /** 把座位号压缩为 0..n-1 连续（有人在等待阶段离开时会出现空缺） */
  private compactSeats(): void {
    [...this.state.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .forEach((p, i) => {
        p.seat = i;
      });
  }

  private isHost(client: Client): boolean {
    return client.sessionId === this.state.hostSessionId;
  }

  private reassignHost(): void {
    if (this.state.players.has(this.state.hostSessionId)) return;
    const next = [...this.state.players.values()].find((p) => !p.isAi);
    this.state.hostSessionId = next?.sessionId ?? "";
  }
}

function clampPlayers(n: number): number {
  return Math.min(4, Math.max(2, Math.floor(n)));
}
