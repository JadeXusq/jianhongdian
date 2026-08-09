/**
 * 网络层：封装 Colyseus 连接，向 UI 暴露状态与回调。
 * 不含任何渲染逻辑，将来接 Cocos 时可原样复用。
 */
import { Client, Room } from "colyseus.js";
import type { GameEvent } from "@jhd/shared";

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
  onLeave?: () => void;

  get state(): any {
    return this.room?.state;
  }

  onProgress?: (msg: string) => void;

  private joining = false;

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

  /** 刷新页面后尝试回到原对局；无有效凭据则返回 false */
  async tryReconnect(): Promise<boolean> {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    try {
      this.bind(await this.client.reconnect(token));
      return true;
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
      return false;
    }
  }

  private bind(room: Room<any>): void {
    this.room = room;
    sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);

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
      if (this.mySeat < 0 && !this.spectating) {
        const me = state.players.get(room.sessionId);
        if (me) this.mySeat = me.seat;
      }
      this.onState?.(state);
    });
    room.onLeave(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      this.room = null;
      this.mySeat = -1;
      this.hand = [];
      this.spectating = false;
      this.onLeave?.();
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
    sessionStorage.removeItem(TOKEN_KEY);
    await this.room?.leave(true);
  }
}
