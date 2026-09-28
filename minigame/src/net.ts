/**
 * 网络层：与 client/src/net.ts 接口同名同语义，底层走小游戏适配层。
 * 断线 token 存本地存储（小游戏没有 sessionStorage），过期由服务端拒绝。
 */
import "./platform/polyfill";
import { Client, Room } from "colyseus.js";
import { RECONNECT_MS, type GameEvent } from "@jhd/shared";
import { http, storage } from "./platform";

declare const __WS_URL__: string;

const WS_URL = __WS_URL__;
const HTTP_URL = WS_URL.replace(/^ws/, "http");
const TOKEN_KEY = "jhd.reconnect";
const DEVICE_KEY = "jhd.device";

/** 远程部署（wss）才需要休眠唤醒 */
export function hasRemoteWs(): boolean {
  return WS_URL.startsWith("wss://");
}

export function wsEndpoint(): string {
  return WS_URL;
}

function endpoint(url: string) {
  const m = /^(wss?):\/\/([^:/]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) throw new Error(`无效地址 ${url}`);
  const secure = m[1] === "wss";
  return {
    hostname: m[2],
    port: m[3] ? Number(m[3]) : secure ? 443 : 80,
    secure,
    pathname: m[4] ?? "",
  };
}

/**
 * 免费云（如 Render）休眠后首连需先打 HTTP 唤醒。
 * 最长约 90s；成功或最终失败后返回。
 */
async function wakeServer(onProgress?: (msg: string) => void): Promise<void> {
  const deadline = Date.now() + 90_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    onProgress?.(
      attempt === 1
        ? "正在连接服务器…"
        : `服务器唤醒中（约需 30~60 秒）… ${attempt}`
    );
    try {
      const res = await http(`${HTTP_URL}/api/health`, { timeout: 12_000 });
      if (res.ok) return;
    } catch {
      /* 休眠或网络未就绪，继续重试 */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("服务器未响应，请稍后重试或先用人机练习");
}

async function withWake<T>(
  fn: () => Promise<T>,
  onProgress?: (msg: string) => void
): Promise<T> {
  if (hasRemoteWs()) await wakeServer(onProgress);
  return fn();
}

/** 游客设备标识：本地生成并长期保留，用于累计战绩 */
export function deviceId(): string {
  let id = storage.get(DEVICE_KEY);
  if (!id) {
    id = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")
    ).join("");
    storage.set(DEVICE_KEY, id);
  }
  return id;
}

export interface Profile {
  deviceId: string;
  accountId?: string;
  name: string;
  games: number;
  wins: number;
  totalNet: number;
}

export interface RoundOver {
  points: number[];
  base: number;
  net: number[];
  captured: number[][];
  round: number;
  totalRounds: number;
  allDone: boolean;
  roundNets?: number[][];
}

export class Net {
  private client = new Client(endpoint(WS_URL));
  room: Room<any> | null = null;
  mySeat = -1;
  hand: number[] = [];
  spectating = false;

  onState?: (state: any) => void;
  onEvents?: (events: GameEvent[]) => void;
  onRoundStart?: () => void;
  onRoundOver?: (r: RoundOver) => void;
  onEmote?: (e: { seat: number; name: string; id: string }) => void;
  onHand?: () => void;
  onChat?: (e: { seat: number; name: string; text: string }) => void;
  onError?: (message: string) => void;
  onSwapAsk?: (m: { fromName: string; fromSeat: number; seat: number }) => void;
  onSwapCancel?: () => void;
  onLeave?: (consented: boolean) => void;
  onMatchHistory?: (m: { roundNets: number[][]; round: number }) => void;
  onDropped?: () => void;
  onRecoverHold?: () => void;
  onReconnected?: () => void;

  get state(): any {
    return this.room?.state;
  }

  onProgress?: (msg: string) => void;

  /** 断线后自动重连进行中（切回前台时不重复发起） */
  recovering = false;
  private joining = false;
  private intentionalLeave = false;
  private recoverAborted = false;
  private pingTimer = 0;

  async create(name: string, maxPlayers: number, themeId?: string): Promise<void> {
    await this.enterRoom(() =>
      this.client.create("game", {
        name,
        maxPlayers,
        deviceId: deviceId(),
        themeId,
      })
    );
  }

  async quickMatch(name: string, maxPlayers: number, themeId?: string): Promise<void> {
    await this.enterRoom(() =>
      this.client.joinOrCreate("game", {
        name,
        maxPlayers,
        deviceId: deviceId(),
        themeId,
      })
    );
  }

  private async roomIdByCode(code: string): Promise<string> {
    const res = await http(`${HTTP_URL}/api/room/${code}`);
    if (!res.ok) throw new Error("房间不存在或已解散");
    return res.data.roomId;
  }

  async joinByCode(name: string, code: string): Promise<void> {
    await this.enterRoom(async () =>
      this.client.joinById(await this.roomIdByCode(code), {
        name,
        deviceId: deviceId(),
      })
    );
  }

  async spectateByCode(name: string, code: string): Promise<void> {
    await this.enterRoom(async () =>
      this.client.joinById(await this.roomIdByCode(code), {
        name,
        deviceId: deviceId(),
        spectate: true,
      })
    );
  }

  private async enterRoom(connect: () => Promise<Room<any>>): Promise<void> {
    if (this.joining) throw new Error("正在进入房间，请稍候");
    this.joining = true;
    try {
      await this.leave().catch(() => undefined);
      this.bind(await withWake(connect, this.onProgress));
    } finally {
      this.joining = false;
    }
  }

  async leaderboard(): Promise<Profile[]> {
    return withWake(async () => {
      const res = await http(`${HTTP_URL}/api/leaderboard`);
      if (!res.ok) throw new Error("排行榜获取失败");
      return res.data;
    }, this.onProgress);
  }

  async activeMatch(): Promise<{
    roomId: string;
    code: string;
    seat: number;
    phase: string;
  } | null> {
    try {
      const res = await http(`${HTTP_URL}/api/active-match/${deviceId()}`);
      return res.ok ? res.data : null;
    } catch {
      return null;
    }
  }

  /** 同一设备：先用断线 token，再用 deviceId 认领原座位 */
  async tryResumeSeat(name: string): Promise<boolean> {
    if (this.room) return true;
    if (await this.tryReconnect()) return true;
    const hit = await this.activeMatch();
    if (!hit) return false;
    try {
      await this.enterRoom(() =>
        this.client.joinById(hit.roomId, { name, deviceId: deviceId() })
      );
      return true;
    } catch {
      return false;
    }
  }

  /** 重启后尝试回到原对局；无有效凭据则返回 false */
  async tryReconnect(): Promise<boolean> {
    const token = storage.get(TOKEN_KEY);
    if (!token) return false;
    try {
      this.bind(
        await withWake(() => this.client.reconnect(token), this.onProgress)
      );
      return true;
    } catch {
      storage.remove(TOKEN_KEY);
      return false;
    }
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = 0;
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      try {
        this.room?.send("ping");
      } catch {
        /* 断开时由 onLeave 处理 */
      }
    }, 20_000) as unknown as number;
  }

  abandonRecover(): void {
    this.recoverAborted = true;
    this.intentionalLeave = true;
    storage.remove(TOKEN_KEY);
  }

  private async recoverAfterDrop(): Promise<void> {
    this.recovering = true;
    try {
      await this.recoverLoop();
    } finally {
      this.recovering = false;
    }
  }

  private async recoverLoop(): Promise<void> {
    const token = storage.get(TOKEN_KEY);
    if (!token || this.joining || this.intentionalLeave || this.recoverAborted) {
      this.finishGone();
      return;
    }
    this.recoverAborted = false;
    this.onProgress?.("连接断开，正在重连…");
    const deadline = Date.now() + Math.max(8_000, RECONNECT_MS - 3_000);
    let delay = 800;
    let attempt = 0;
    let quickFails = 0;
    while (Date.now() < deadline) {
      if (this.joining || this.intentionalLeave || this.recoverAborted) return;
      const t0 = Date.now();
      try {
        this.bind(await this.client.reconnect(token));
        this.onProgress?.("已重新连上");
        this.onReconnected?.();
        return;
      } catch {
        attempt++;
        if (Date.now() - t0 < 500) quickFails++;
        else quickFails = 0;
        if (attempt === 2 || quickFails === 2) this.onRecoverHold?.();
        if (quickFails >= 3) break;
        const left = deadline - Date.now();
        if (left <= 0) break;
        await new Promise((r) => setTimeout(r, Math.min(delay, left)));
        delay = Math.min(delay + 500, 3_000);
      }
    }
    if (this.joining || this.intentionalLeave || this.recoverAborted) return;
    storage.remove(TOKEN_KEY);
    this.finishGone();
  }

  private finishGone(): void {
    this.mySeat = -1;
    this.spectating = false;
    this.hand = [];
    this.onLeave?.(false);
  }

  private bind(room: Room<any>): void {
    this.recoverAborted = false;
    this.room = room;
    storage.set(TOKEN_KEY, room.reconnectionToken);
    this.startPing();

    room.onMessage("joined", (m: { seat: number; spectate?: boolean }) => {
      this.mySeat = m.seat;
      this.spectating = !!m.spectate || m.seat < 0;
    });
    room.onMessage("hand", (hand: number[]) => {
      this.hand = hand;
      this.onHand?.();
    });
    room.onMessage("roundStart", () => this.onRoundStart?.());
    room.onMessage("events", (e: GameEvent[]) => this.onEvents?.(e));
    room.onMessage("roundOver", (r: RoundOver) => this.onRoundOver?.(r));
    room.onMessage("matchHistory", (m: { roundNets: number[][]; round: number }) =>
      this.onMatchHistory?.(m)
    );
    room.onMessage("emote", (e: { seat: number; name: string; id: string }) =>
      this.onEmote?.(e)
    );
    room.onMessage("chat", (e: { seat: number; name: string; text: string }) => this.onChat?.(e));
    room.onMessage("error", (e: { message: string }) => this.onError?.(e.message));
    room.onMessage(
      "swapAsk",
      (m: { fromName: string; fromSeat: number; seat: number }) => this.onSwapAsk?.(m)
    );
    room.onMessage("swapCancel", () => this.onSwapCancel?.());
    room.onStateChange((state) => {
      if (room.reconnectionToken) storage.set(TOKEN_KEY, room.reconnectionToken);
      const me = state.players.get(room.sessionId);
      if (me) this.mySeat = me.seat;
      this.onState?.(state);
    });
    room.onLeave(() => {
      this.clearPing();
      const consented = this.intentionalLeave;
      this.intentionalLeave = false;
      this.room = null;
      this.hand = [];
      if (consented) {
        storage.remove(TOKEN_KEY);
        this.mySeat = -1;
        this.spectating = false;
        this.onLeave?.(true);
        return;
      }
      this.onDropped?.();
      void this.recoverAfterDrop();
    });
  }

  ready(v: boolean): void {
    this.room?.send("ready", v);
  }
  sit(seat: number): void {
    this.room?.send("sit", seat);
  }
  swapAsk(seat: number): void {
    this.room?.send("swapAsk", seat);
  }
  swapReply(accept: boolean): void {
    this.room?.send("swapReply", accept);
  }
  addAi(): void {
    this.room?.send("addAi");
  }
  removeAi(seat: number): void {
    this.room?.send("removeAi", seat);
  }
  play(cardId: number, targetId?: number): void {
    this.room?.send("play", { cardId, targetId });
  }
  chooseTarget(targetId: number): void {
    this.room?.send("chooseTarget", { targetId });
  }
  emote(id: string): void {
    this.room?.send("emote", { id });
  }
  chat(text: string): void {
    this.room?.send("chat", { text });
  }
  nextRound(): void {
    this.room?.send("nextRound");
  }
  endMatch(): void {
    this.room?.send("endMatch");
  }
  setTheme(themeId: string): void {
    this.room?.send("setTheme", { themeId });
  }
  async leave(): Promise<void> {
    this.recoverAborted = true;
    this.intentionalLeave = true;
    this.clearPing();
    storage.remove(TOKEN_KEY);
    this.intentionalLeave = false;
    const room = this.room;
    if (!room) return;
    this.room = null;
    this.mySeat = -1;
    this.spectating = false;
    this.hand = [];
    // 不等关闭握手（真机 connectSocket 关闭回调很慢），本地立即脱离；服务端照常收到离开
    void room.leave(true).catch(() => undefined);
    room.removeAllListeners();
    this.onLeave?.(true);
  }
}
