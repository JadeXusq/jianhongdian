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
  captureAnimMs,
  dealOpenMs,
  discardAnimMs,
  NAME_MAX_LEN,
  resolveThemeId,
  isThemeInput,
} from "@jhd/shared";
import {
  registerCode,
  registerDeviceSeat,
  unregisterCode,
  unregisterDeviceSeat,
  unregisterRoomDevices,
} from "./roomCodes";
import { recordResult } from "./store";
import { PlayerSchema, RoomState, TurnPhase } from "./state";

export interface JoinOptions {
  name?: string;
  avatar?: string;
  maxPlayers?: number;
  /** 总轮数：0=无限（房主结算结束）；>0 打满自动结束（兼容旧客户端） */
  totalRounds?: number;
  /** 游客账号标识，用于战绩累计 */
  deviceId?: string;
  /** 以观战身份进入（不占座位、无手牌、不可操作） */
  spectate?: boolean;
  /** 建房时的默认主题（仅 onCreate / 首进房生效） */
  themeId?: string;
  /** 续开已关闭房间时占用原 6 位房号 */
  preferredCode?: string;
  resumeSeat?: number;
  resume?: {
    round: number;
    roundNets: number[][];
    players: { seat: number; name: string; isAi?: boolean; totalNet: number }[];
  };
}

export class GameRoom extends Room<RoomState> {
  private game: Game | null = null;
  /** seat → 手牌（私密） */
  private hands = new Map<number, number[]>();
  private turnTimer: { clear(): void } | null = null;
  private aiCounter = 0;
  /** 玩家 → 游客设备标识（不能用座位号做 key，座位会因压缩而变）*/
  private devices = new Map<PlayerSchema, string>();
  /** 观战者 sessionId */
  private spectators = new Set<string>();
  /** 上一手客户端动画垫时，叠加到下一次 AI 出牌等待 */
  private animPadMs = 0;
  /** 本场是否已由房主结算（或打满固定轮） */
  private matchClosed = false;
  /** 房主点了结算：本轮结束后关闭本场 */
  private settleAfterRound = false;
  /** 各轮净胜分：roundNets[roundIndex][seat] */
  private roundNets: number[][] = [];
  private pendingResume: JoinOptions["resume"] | null = null;
  private pendingResumeSeat = 0;
  private seatSwap: { from: string; to: string } | null = null;

  onCreate(options: JoinOptions): void {
    const maxPlayers = clampPlayers(options.maxPlayers ?? 4);
    this.maxClients = maxPlayers + 8;
    this.setState(new RoomState());
    this.state.maxPlayers = maxPlayers;
    const tr = options.totalRounds;
    this.state.totalRounds =
      tr === undefined ? 0 : Math.min(20, Math.max(0, Math.floor(tr)));
    this.state.code = registerCode(this.roomId, options.preferredCode);
    this.setMetadata({ code: this.state.code, maxPlayers });
    if (options.resume?.players?.length) {
      this.pendingResume = options.resume;
      this.pendingResumeSeat = Number(options.resumeSeat) || 0;
    }

    this.onMessage("ready", (client, ready: boolean) =>
      this.onReady(client, ready)
    );
    this.onMessage("addAi", (client) => this.onAddAi(client));
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
    this.onMessage("endMatch", (client) => this.onEndMatch(client));
    this.onMessage("emote", (client, msg: { id?: string }) =>
      this.onEmote(client, msg)
    );
    this.onMessage("chat", (client, msg: { text?: string }) =>
      this.onChat(client, msg)
    );
    this.onMessage("setTheme", (client, msg: { themeId?: string }) =>
      this.onSetTheme(client, msg)
    );
    this.onMessage("ping", () => undefined);
    this.onMessage("sit", (client, seat: number) => this.onSit(client, seat));
    this.onMessage("swapAsk", (client, seat: number) =>
      this.onSwapAsk(client, seat)
    );
    this.onMessage("swapReply", (client, accept: boolean) =>
      this.onSwapReply(client, accept)
    );
    this.state.themeId = resolveThemeId(options.themeId);
  }

  private onSetTheme(client: Client, msg: { themeId?: string }): void {
    if (!this.isHost(client)) {
      client.send("error", { message: "仅房主可切换主题" });
      return;
    }
    if (!isThemeInput(msg.themeId)) {
      client.send("error", { message: "未知主题" });
      return;
    }
    this.state.themeId = resolveThemeId(msg.themeId);
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
    if (options.deviceId) {
      const mine = this.playerByDevice(options.deviceId);
      if (mine) {
        this.reclaimSeat(client, mine, options);
        this.sendHistory(client);
        return;
      }
    }
    if (this.pendingResume) {
      this.applyResume(client, options);
      return;
    }
    if (this.state.phase !== "WAITING") {
      throw new Error("对局已开始，请选择观战加入");
    }
    const hold = this.takeHoldSeat(options.name);
    if (hold) {
      this.reclaimSeat(client, hold, options);
      this.sendHistory(client);
      return;
    }
    // 同设备重复进房（iOS 双击/重连）时挤掉旧座位，避免占两席
    if (options.deviceId) this.evictDevice(options.deviceId, client.sessionId);
    const seat = this.freeSeat();
    if (seat < 0) throw new Error("房间已满");
    const p = new PlayerSchema();
    p.sessionId = client.sessionId;
    p.seat = seat;
    p.name = (options.name || `玩家${seat + 1}`).slice(0, NAME_MAX_LEN);
    p.avatar = options.avatar ?? "";
    if (options.deviceId) this.devices.set(p, options.deviceId);
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    this.syncDeviceSeat(p);
    client.send("joined", { seat, code: this.state.code, spectate: false });
    this.sendHistory(client);
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
      const id = this.devices.get(p);
      this.devices.delete(p);
      if (id) unregisterDeviceSeat(id);
      if (this.roundNets.length && this.state.phase === "WAITING" && !p.isAi) {
        this.clearSeatSwap(client.sessionId);
        this.state.players.delete(client.sessionId);
        p.sessionId = `hold:${p.seat}`;
        p.connected = false;
        p.ready = false;
        this.state.players.set(p.sessionId, p);
        this.reassignHost();
        return;
      }
      this.state.players.delete(client.sessionId);
      this.reassignHost();
      this.clearSeatSwap(client.sessionId);
      return;
    }

    p.connected = false;
    this.syncDeviceSeat(p);
    this.driveIfAutoTurn();
    const leftSession = client.sessionId;
    try {
      await this.allowReconnection(client, RECONNECT_MS / 1000);
      if (p.sessionId !== leftSession) return;
      p.connected = true;
      p.sessionId = client.sessionId;
      this.sendHand(p.seat);
    } catch {
      if (p.sessionId === leftSession && !p.connected) p.isAi = true;
    }
  }

  onDispose(): void {
    unregisterRoomDevices(this.roomId);
    unregisterCode(this.state.code);
  }

  // ---------- 等待阶段 ----------

  private waitingPlayer(client: Client): PlayerSchema | null {
    if (this.state.phase !== "WAITING") {
      client.send("error", { message: "对局已开始，不能换座" });
      return null;
    }
    return this.state.players.get(client.sessionId) ?? null;
  }

  private clearSeatSwap(sessionId?: string): void {
    const ask = this.seatSwap;
    if (!ask) return;
    if (sessionId && ask.from !== sessionId && ask.to !== sessionId) return;
    this.seatSwap = null;
    for (const id of [ask.from, ask.to]) {
      if (id === sessionId) continue;
      this.clients.find((c) => c.sessionId === id)?.send("swapCancel", {});
    }
  }

  private swapSeats(a: PlayerSchema, b: PlayerSchema): void {
    const seat = a.seat;
    a.seat = b.seat;
    b.seat = seat;
    a.ready = false;
    if (!b.isAi) b.ready = false;
    this.syncDeviceSeat(a);
    this.syncDeviceSeat(b);
    this.seatSwap = null;
  }

  private onSit(client: Client, seat: number): void {
    const me = this.waitingPlayer(client);
    if (!me) return;
    const to = Math.floor(Number(seat));
    if (to < 0 || to >= this.state.maxPlayers || to === me.seat) return;
    const occ = this.playerBySeat(to);
    if (!occ) {
      me.seat = to;
      me.ready = false;
      this.syncDeviceSeat(me);
      this.clearSeatSwap(me.sessionId);
      return;
    }
    if (
      occ.isAi ||
      String(occ.sessionId).startsWith("hold:") ||
      !occ.connected
    ) {
      this.swapSeats(me, occ);
      return;
    }
    client.send("error", { message: "该座位有人，请点对方申请对换" });
  }

  private onSwapAsk(client: Client, seat: number): void {
    const me = this.waitingPlayer(client);
    if (!me) return;
    const to = Math.floor(Number(seat));
    const occ = this.playerBySeat(to);
    if (!occ || occ.sessionId === me.sessionId) return;
    if (
      occ.isAi ||
      String(occ.sessionId).startsWith("hold:") ||
      !occ.connected
    ) {
      this.swapSeats(me, occ);
      return;
    }
    if (this.seatSwap) this.clearSeatSwap();
    this.seatSwap = { from: me.sessionId, to: occ.sessionId };
    const target = this.clients.find((c) => c.sessionId === occ.sessionId);
    target?.send("swapAsk", {
      fromName: me.name,
      fromSeat: me.seat,
      seat: occ.seat,
    });
  }

  private onSwapReply(client: Client, accept: boolean): void {
    const ask = this.seatSwap;
    if (!ask || ask.to !== client.sessionId) {
      client.send("error", { message: "换座申请已失效" });
      return;
    }
    const from = this.state.players.get(ask.from);
    const to = this.state.players.get(ask.to);
    this.seatSwap = null;
    if (!accept) {
      this.clients
        .find((c) => c.sessionId === ask.from)
        ?.send("error", { message: "对方拒绝换座" });
      return;
    }
    if (!from || !to || this.state.phase !== "WAITING") return;
    this.swapSeats(from, to);
  }

  private onReady(client: Client, ready: boolean): void {
    if (this.state.phase === "PLAYING") return;
    if (this.matchClosed && this.state.phase === "ROUND_OVER") return;
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = ready;
    this.startIfAllReady();
  }

  private onAddAi(client: Client): void {
    if (!this.isHost(client) || this.state.phase === "PLAYING") return;
    const seat = this.freeSeat();
    if (seat < 0) return;
    const p = new PlayerSchema();
    p.sessionId = `ai:${++this.aiCounter}`;
    p.seat = seat;
    p.name =
      this.state.maxPlayers === 2 ? "机器人" : `机器人 ${seat}`;
    p.isAi = true;
    p.ready = true;
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
    }
  }

  private startIfAllReady(): void {
    const players = [...this.state.players.values()];
    if (players.length !== this.state.maxPlayers) return;
    if (!players.every((p) => p.ready)) return;
    if (this.matchClosed) this.resetMatch();
    this.startRound();
  }

  private onNextRound(client: Client): void {
    if (this.state.phase !== "ROUND_OVER") return;
    if (this.matchClosed) {
      // 再来一局：任一玩家点击即重置开局
      this.resetMatch();
      this.state.players.forEach((p) => (p.ready = true));
      this.startRound();
      return;
    }
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = true;
    if ([...this.state.players.values()].every((x) => x.ready || x.isAi)) {
      this.state.players.forEach((x) => {
        if (x.isAi) x.ready = true;
      });
      if ([...this.state.players.values()].every((x) => x.ready))
        this.startRound();
    }
  }

  private onEndMatch(client: Client): void {
    if (!this.isHost(client)) {
      client.send("error", { message: "仅房主可结算对局" });
      return;
    }
    if (this.matchClosed) return;
    if (this.state.phase === "PLAYING") {
      this.settleAfterRound = true;
      client.send("error", { message: "本轮结束后将结算本场" });
      return;
    }
    if (this.state.phase === "ROUND_OVER") {
      this.closeMatch();
    }
  }

  private resetMatch(): void {
    this.matchClosed = false;
    this.settleAfterRound = false;
    this.roundNets = [];
    this.state.round = 0;
    this.state.roundStarter = -1;
    this.state.players.forEach((p) => {
      p.totalNet = 0;
      p.points = 0;
      p.ready = false;
    });
  }

  // ---------- 对局 ----------

  private startRound(): void {
    this.clearSeatSwap();
    if (!this.roundNets.length) this.compactSeats();
    const count = this.state.players.size;
    // 首轮随机庄；之后按顺时针（座位号递减，与出牌方向一致）
    if (this.state.roundStarter < 0) {
      this.state.roundStarter = Math.floor(Math.random() * count);
    } else {
      this.state.roundStarter =
        (this.state.roundStarter - 1 + count) % count;
    }
    this.game = new Game(count, Date.now(), this.state.roundStarter);
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
    this.syncAllDeviceSeats();
    this.broadcast("roundStart", { round: this.state.round });
    this.state.players.forEach((p) => this.sendHand(p.seat));
    // 发牌动画 + 看牌后再让 AI/托管出手
    this.animPadMs = dealOpenMs(count);
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
    this.animPadMs = events.reduce(
      (sum, ev) =>
        sum + (ev.target === undefined ? discardAnimMs() : captureAnimMs()),
      0
    );
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
    const pad = this.animPadMs;
    this.animPadMs = 0;

    this.state.currentSeat = seat;
    this.state.turnPhase = g.phase as TurnPhase;
    this.state.pendingStockCard = g.pendingStockCard;

    this.turnTimer?.clear();
    if (auto) {
      // 先等动画垫时，再固定思考 AI_DELAY_MS，避免与动画重叠导致“秒出”
      this.state.turnDeadline = Date.now() + pad + AI_DELAY_MS;
      this.turnTimer = this.clock.setTimeout(() => {
        this.turnTimer = this.clock.setTimeout(
          () => this.autoPlay(),
          AI_DELAY_MS
        );
      }, Math.max(0, pad));
      return;
    }
    this.state.turnDeadline = Date.now() + TURN_MS + pad;
    this.turnTimer = this.clock.setTimeout(() => this.autoPlay(), TURN_MS + pad);
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
    if (g.phase === "CHOOSE_STOCK_TARGET") {
      this.afterMove(
        g.chooseStockTarget(seat, bestTarget(g.stockTargets())),
        seat
      );
      return;
    }
    const move = chooseHandPlay(g.players[seat].hand, [...g.table]);
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
    this.roundNets.push([...result.net]);
    this.state.phase = "ROUND_OVER";
    this.syncAllDeviceSeats();
    this.state.currentSeat = -1;
    this.state.turnDeadline = 0;
    const fixedDone =
      this.state.totalRounds > 0 && this.state.round >= this.state.totalRounds;
    const allDone = fixedDone || this.settleAfterRound;
    if (allDone) this.matchClosed = true;
    this.settleAfterRound = false;
    this.broadcast("roundOver", {
      points: result.points,
      base: result.base,
      net: result.net,
      captured: this.game!.players.map((p) => p.captured),
      round: this.state.round,
      totalRounds: allDone ? this.state.round : this.state.totalRounds,
      allDone,
      roundNets: this.roundNets,
    });
  }

  /** 在轮间直接关闭本场（不再开下一轮） */
  private closeMatch(): void {
    this.matchClosed = true;
    this.settleAfterRound = false;
    this.state.phase = "ROUND_OVER";
    this.syncAllDeviceSeats();
    const bySeat = [...this.state.players.values()].sort(
      (a, b) => a.seat - b.seat
    );
    this.broadcast("roundOver", {
      points: bySeat.map((p) => p.totalNet),
      base: 0,
      net: bySeat.map((p) => p.totalNet),
      captured: bySeat.map(() => [] as number[]),
      round: this.state.round,
      totalRounds: this.state.round,
      allDone: true,
      roundNets: this.roundNets,
    });
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
    "好牌",
    "厉害",
    "等等",
    "哈哈哈",
    "谢谢",
    "倒霉",
    "再来",
  ]);
  private lastEmoteAt = new Map<string, number>();
  private lastChatAt = new Map<string, number>();

  private onEmote(client: Client, msg: { id?: string }): void {
    const text = (msg?.id || "").slice(0, 8);
    if (!GameRoom.EMOTES.has(text)) return;
    const now = Date.now();
    const prev = this.lastEmoteAt.get(client.sessionId) ?? 0;
    if (now - prev < 1200) return;
    this.lastEmoteAt.set(client.sessionId, now);
    const p = this.state.players.get(client.sessionId);
    const name = p?.name ?? "观众";
    const seat = p?.seat ?? -1;
    this.broadcast("emote", { seat, name, id: text });
  }

  private onChat(client: Client, msg: { text?: string }): void {
    const text = (msg?.text || "").trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    const prev = this.lastChatAt.get(client.sessionId) ?? 0;
    if (now - prev < 1200) return;
    this.lastChatAt.set(client.sessionId, now);
    const p = this.state.players.get(client.sessionId);
    const name = p?.name ?? "观众";
    const seat = p?.seat ?? -1;
    this.broadcast("chat", { seat, name, text, ts: now });
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

  /** 等待阶段：同 deviceId 只保留最新连接 */
  private evictDevice(deviceId: string, keepSessionId: string): void {
    if (this.state.phase !== "WAITING") return;
    for (const p of [...this.state.players.values()]) {
      if (p.isAi || p.sessionId === keepSessionId) continue;
      if (this.devices.get(p) !== deviceId) continue;
      this.devices.delete(p);
      unregisterDeviceSeat(deviceId);
      this.state.players.delete(p.sessionId);
      const old = this.clients.find((c) => c.sessionId === p.sessionId);
      old?.leave(4000);
      if (this.state.hostSessionId === p.sessionId) this.reassignHost();
    }
  }

  private sendHistory(client: Client): void {
    if (!this.roundNets.length) return;
    client.send("matchHistory", {
      roundNets: this.roundNets,
      round: this.state.round,
    });
  }

  private takeHoldSeat(name?: string): PlayerSchema | undefined {
    const holds = [...this.state.players.values()].filter(
      (p) => !p.isAi && String(p.sessionId).startsWith("hold:")
    );
    if (!holds.length) return undefined;
    const n = String(name || "").trim();
    return (n && holds.find((p) => p.name === n)) || holds[0];
  }

  private applyResume(client: Client, options: JoinOptions): void {
    const resume = this.pendingResume;
    this.pendingResume = null;
    if (!resume?.players?.length) return;
    this.roundNets = (resume.roundNets ?? []).map((row) => [...row]);
    this.state.round = Math.max(
      0,
      Math.floor(Number(resume.round)) || this.roundNets.length
    );
    const rows = [...resume.players].sort((a, b) => a.seat - b.seat);
    this.state.maxPlayers = clampPlayers(rows.length);
    let mySeat = this.pendingResumeSeat;
    if (!rows.some((r) => r.seat === mySeat)) mySeat = rows[0].seat;
    for (const row of rows) {
      const total = Number(row.totalNet) || 0;
      const name = String(row.name || `玩家${row.seat + 1}`).slice(
        0,
        NAME_MAX_LEN
      );
      if (row.seat === mySeat) {
        const p = new PlayerSchema();
        p.sessionId = client.sessionId;
        p.seat = row.seat;
        p.name = (options.name || name).slice(0, NAME_MAX_LEN);
        p.totalNet = total;
        p.connected = true;
        if (options.deviceId) this.devices.set(p, options.deviceId);
        this.state.players.set(client.sessionId, p);
        this.state.hostSessionId = client.sessionId;
        this.syncDeviceSeat(p);
        client.send("joined", {
          seat: p.seat,
          code: this.state.code,
          spectate: false,
        });
        continue;
      }
      const p = new PlayerSchema();
      if (row.isAi) {
        p.sessionId = `ai:${++this.aiCounter}`;
        p.isAi = true;
        p.ready = true;
        p.connected = true;
      } else {
        p.sessionId = `hold:${row.seat}`;
        p.connected = false;
      }
      p.seat = row.seat;
      p.name = name;
      p.totalNet = total;
      this.state.players.set(p.sessionId, p);
    }
    this.sendHistory(client);
  }

  private playerByDevice(deviceId: string): PlayerSchema | undefined {
    if (!deviceId) return undefined;
    return [...this.state.players.values()].find(
      (p) => this.devices.get(p) === deviceId
    );
  }

  private reclaimSeat(
    client: Client,
    p: PlayerSchema,
    options: JoinOptions
  ): void {
    const oldSession = p.sessionId;
    if (oldSession && oldSession !== client.sessionId) {
      this.state.players.delete(oldSession);
      const old = this.clients.find((c) => c.sessionId === oldSession);
      old?.leave(4000);
    }
    p.sessionId = client.sessionId;
    p.connected = true;
    p.isAi = false;
    if (options.name) p.name = options.name.slice(0, NAME_MAX_LEN);
    if (options.deviceId) this.devices.set(p, options.deviceId);
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostSessionId || this.state.hostSessionId === oldSession)
      this.state.hostSessionId = client.sessionId;
    this.syncDeviceSeat(p);
    client.send("joined", {
      seat: p.seat,
      code: this.state.code,
      spectate: false,
    });
    this.sendHand(p.seat);
    if (this.state.phase === "PLAYING") this.driveIfAutoTurn();
  }

  private syncDeviceSeat(p: PlayerSchema): void {
    const id = this.devices.get(p);
    if (!id) return;
    registerDeviceSeat(id, {
      roomId: this.roomId,
      code: this.state.code,
      seat: p.seat,
      phase: this.state.phase,
    });
  }

  private syncAllDeviceSeats(): void {
    this.state.players.forEach((p) => this.syncDeviceSeat(p));
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
