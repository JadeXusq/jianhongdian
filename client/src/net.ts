/**
 * 网络层：封装 Colyseus 连接，向 UI 暴露状态与回调。
 * 不含任何渲染逻辑，将来接 Cocos 时可原样复用。
 */
import { Client, Room } from "colyseus.js";
import { RECONNECT_MS, type GameEvent } from "@jhd/shared";

const WS_URL =
  (import.meta.env.VITE_WS as string | undefined)?.trim() ||
  `ws://${location.hostname}:2567`;
const HTTP_URL = WS_URL.replace(/^ws/, "http");
const TOKEN_KEY = "jhd.reconnect";
const DEVICE_KEY = "jhd.device";

/** 是否已配置远程 WebSocket（GitHub Pages 联网依赖此项） */
export function hasRemoteWs(): boolean {
  return !!(import.meta.env.VITE_WS as string | undefined)?.trim();
}

export function wsEndpoint(): string {
  return WS_URL;
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
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(`${HTTP_URL}/api/health`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (res.ok) return;
    } catch {
      /* 休眠或网络未就绪，继续重试 */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("服务器未响应，请稍后重试或先用人机练习");
}

function assertOnlineReady(): void {
  if (location.protocol === "https:" && !hasRemoteWs()) {
    throw new Error("联网未配置，请先用人机练习；或部署服务端后设置 VITE_WS");
  }
}

async function withWake<T>(
  fn: () => Promise<T>,
  onProgress?: (msg: string) => void
): Promise<T> {
  assertOnlineReady();
  if (hasRemoteWs()) await wakeServer(onProgress);
  return fn();
}

/**
 * 游客设备标识：本地生成并长期保留，用于累计战绩。
 * 不能用 crypto.randomUUID：它仅在安全上下文（HTTPS / localhost）下存在，
 * 而局域网 IP 访问是普通 HTTP。getRandomValues 无此限制，不可用时降级到 Math.random。
 */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Profile {
  deviceId: string;
  accountId?: string;
  name: string;
  games: number;
  wins: number;
  totalNet: number;
}

const ACCOUNT_KEY = "jhd.accountId";
const TOKEN_KEY_ACC = "jhd.accountToken";

export function savedAccountId(): string | null {
  return localStorage.getItem(ACCOUNT_KEY);
}

export function savedAccountToken(): string | null {
  return localStorage.getItem(TOKEN_KEY_ACC);
}

export function rememberAccount(accountId: string, token: string): void {
  localStorage.setItem(ACCOUNT_KEY, accountId);
  localStorage.setItem(TOKEN_KEY_ACC, token);
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
  private client = new Client(WS_URL);
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
  onChat?: (e: {
    seat: number;
    name: string;
    text: string;
    ts: number;
  }) => void;
  onError?: (message: string) => void;
  onLeave?: (consented: boolean) => void;
  onDropped?: () => void;
  onRecoverHold?: () => void;
  onReconnected?: () => void;

  get state(): any {
    return this.room?.state;
  }

  onProgress?: (msg: string) => void;

  private joining = false;
  private intentionalLeave = false;
  private recoverAborted = false;
  private pingTimer = 0;

  async create(
    name: string,
    maxPlayers: number,
    themeId?: string
  ): Promise<void> {
    await this.enterRoom(() =>
      this.client.create("game", {
        name,
        maxPlayers,
        deviceId: deviceId(),
        themeId,
      })
    );
  }

  async quickMatch(
    name: string,
    maxPlayers: number,
    themeId?: string
  ): Promise<void> {
    await this.enterRoom(() =>
      this.client.joinOrCreate("game", {
        name,
        maxPlayers,
        deviceId: deviceId(),
        themeId,
      })
    );
  }

  async joinByCode(name: string, code: string): Promise<void> {
    await this.enterRoom(async () => {
      const res = await fetch(`${HTTP_URL}/api/room/${code}`);
      if (!res.ok) throw new Error("房间不存在或已解散");
      const { roomId } = await res.json();
      return this.client.joinById(roomId, { name, deviceId: deviceId() });
    });
  }

  async spectateByCode(name: string, code: string): Promise<void> {
    await this.enterRoom(async () => {
      const res = await fetch(`${HTTP_URL}/api/room/${code}`);
      if (!res.ok) throw new Error("房间不存在或已解散");
      const { roomId } = await res.json();
      return this.client.joinById(roomId, {
        name,
        deviceId: deviceId(),
        spectate: true,
      });
    });
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
      const res = await fetch(`${HTTP_URL}/api/leaderboard`);
      if (!res.ok) throw new Error("排行榜获取失败");
      return res.json();
    }, this.onProgress);
  }

  async createAccount(name: string): Promise<{
    accountId: string;
    token: string;
    profile: Profile;
  }> {
    return withWake(async () => {
      const res = await fetch(`${HTTP_URL}/api/account/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("创建账号失败");
      const data = await res.json();
      rememberAccount(data.accountId, data.token);
      await this.bindAccount(data.accountId, data.token);
      return data;
    }, this.onProgress);
  }

  async bindAccount(accountId: string, token: string): Promise<Profile> {
    return withWake(async () => {
      const res = await fetch(`${HTTP_URL}/api/account/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          token,
          deviceId: deviceId(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "绑定失败");
      }
      const data = await res.json();
      rememberAccount(accountId, token);
      return data.profile;
    }, this.onProgress);
  }

  async activeMatch(): Promise<{
    roomId: string;
    code: string;
    seat: number;
    phase: string;
  } | null> {
    try {
      const res = await fetch(`${HTTP_URL}/api/active-match/${deviceId()}`);
      if (!res.ok) return null;
      return res.json();
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

  /** 刷新页面后尝试回到原对局；无有效凭据则返回 false */
  async tryReconnect(): Promise<boolean> {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      this.bind(
        await withWake(() => this.client.reconnect(token), this.onProgress)
      );
      return true;
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
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
    this.pingTimer = window.setInterval(() => {
      try {
        this.room?.send("ping");
      } catch {
        /* 断开时由 onLeave 处理 */
      }
    }, 20_000);
  }

  abandonRecover(): void {
    this.recoverAborted = true;
    this.intentionalLeave = true;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  private async recoverAfterDrop(): Promise<void> {
    const token = sessionStorage.getItem(TOKEN_KEY);
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
    sessionStorage.removeItem(TOKEN_KEY);
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
    sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
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
    room.onMessage("emote", (e: { seat: number; name: string; id: string }) =>
      this.onEmote?.(e)
    );
    room.onMessage(
      "chat",
      (e: { seat: number; name: string; text: string; ts: number }) =>
        this.onChat?.(e)
    );
    room.onMessage("error", (e: { message: string }) =>
      this.onError?.(e.message)
    );
    room.onStateChange((state) => {
      if (room.reconnectionToken)
        sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
      if (this.mySeat < 0 && !this.spectating) {
        const me = state.players.get(room.sessionId);
        if (me) this.mySeat = me.seat;
      }
      this.onState?.(state);
    });
    room.onLeave(() => {
      this.clearPing();
      const consented = this.intentionalLeave;
      this.intentionalLeave = false;
      this.room = null;
      this.hand = [];
      if (consented) {
        sessionStorage.removeItem(TOKEN_KEY);
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
    sessionStorage.removeItem(TOKEN_KEY);
    const room = this.room;
    if (!room) {
      this.intentionalLeave = false;
      return;
    }
    await room.leave(true);
  }
}
