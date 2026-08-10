/**
 * 网络层：封装 Colyseus 连接，向 UI 暴露状态与回调。
 * 接口与 client/src/net.ts 对齐；Colyseus 取自全局（lib/colyseus.js 插件）。
 */
import type { GameEvent } from "./rules";

declare const Colyseus: {
  Client: new (url: string) => {
    create(room: string, options?: object): Promise<RoomLike>;
    joinOrCreate(room: string, options?: object): Promise<RoomLike>;
    joinById(roomId: string, options?: object): Promise<RoomLike>;
    reconnect(token: string): Promise<RoomLike>;
  };
};

interface RoomLike {
  sessionId: string;
  reconnectionToken: string;
  state: any;
  send(type: string, message?: unknown): void;
  leave(consented?: boolean): Promise<number>;
  onMessage(type: string, cb: (message: any) => void): void;
  onStateChange(cb: (state: any) => void): void;
  onLeave(cb: (code: number) => void): void;
}

function configuredWsUrl(): string | undefined {
  const g = globalThis as any;
  try {
    const q = new URLSearchParams(g.location?.search || "").get("ws")?.trim();
    if (q) return q;
  } catch {
    /* ignore */
  }
  const fromGlobal =
    typeof g.__JHD_WS__ === "string" ? g.__JHD_WS__.trim() : "";
  return fromGlobal || undefined;
}

/** 是否已配置远程 WebSocket（Pages HTTPS 联网依赖此项） */
export function hasRemoteWs(): boolean {
  return !!configuredWsUrl();
}

function defaultWsUrl(): string {
  const configured = configuredWsUrl();
  if (configured) return configured;
  const g = globalThis as any;
  const host =
    typeof g.location?.hostname === "string" && g.location.hostname
      ? g.location.hostname
      : "localhost";
  return `ws://${host}:2567`;
}

function assertOnlineReady(): void {
  const g = globalThis as any;
  if (g.location?.protocol === "https:" && !hasRemoteWs()) {
    throw new Error("联网未配置，请先用人机练习；或部署服务端后设置 ?ws= / __JHD_WS__");
  }
}

const TOKEN_KEY = "jhd.reconnect";
const DEVICE_KEY = "jhd.device";

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
  private wsUrl: string;
  private httpUrl: string;
  private client: InstanceType<typeof Colyseus.Client>;
  room: RoomLike | null = null;
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
    ts?: number;
  }) => void;
  onError?: (message: string) => void;
  onLeave?: () => void;

  constructor(wsUrl = defaultWsUrl()) {
    this.wsUrl = wsUrl;
    this.httpUrl = wsUrl.replace(/^ws/, "http");
    this.client = new Colyseus.Client(wsUrl);
  }

  get state(): any {
    return this.room?.state;
  }

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
      const res = await fetch(`${this.httpUrl}/api/room/${code}`);
      if (!res.ok) throw new Error("房间不存在或已解散");
      const { roomId } = await res.json();
      return this.client.joinById(roomId, { name, deviceId: deviceId() });
    });
  }

  async spectateByCode(name: string, code: string): Promise<void> {
    await this.enterRoom(async () => {
      const res = await fetch(`${this.httpUrl}/api/room/${code}`);
      if (!res.ok) throw new Error("房间不存在或已解散");
      const { roomId } = await res.json();
      return this.client.joinById(roomId, {
        name,
        deviceId: deviceId(),
        spectate: true,
      });
    });
  }

  private async enterRoom(connect: () => Promise<RoomLike>): Promise<void> {
    if (this.joining) throw new Error("正在进入房间，请稍候");
    assertOnlineReady();
    this.joining = true;
    try {
      await this.leave().catch(() => undefined);
      this.bind(await connect());
    } finally {
      this.joining = false;
    }
  }

  async leaderboard(): Promise<Profile[]> {
    const res = await fetch(`${this.httpUrl}/api/leaderboard`);
    if (!res.ok) throw new Error("排行榜获取失败");
    return res.json();
  }

  async createAccount(name: string): Promise<{
    accountId: string;
    token: string;
    profile: Profile;
  }> {
    const res = await fetch(`${this.httpUrl}/api/account/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("创建账号失败");
    return res.json();
  }

  async bindAccount(
    accountId: string,
    token: string
  ): Promise<Profile> {
    const res = await fetch(`${this.httpUrl}/api/account/bind`, {
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
      throw new Error((err as any).error || "绑定失败");
    }
    const data = await res.json();
    return data.profile;
  }

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

  private bind(room: RoomLike): void {
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
      (e: { seat: number; name: string; text: string; ts?: number }) =>
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
  emote(id: string): void {
    this.room?.send("emote", { id });
  }
  chat(text: string): void {
    this.room?.send("chat", { text });
  }
  play(cardId: number, targetId?: number): void {
    this.room?.send("play", { cardId, targetId });
  }
  chooseTarget(targetId: number): void {
    this.room?.send("chooseTarget", { targetId });
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
