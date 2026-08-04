/**
 * 战绩存储：游客按 deviceId；正式账号按 accountId（可绑定多设备并合并战绩）。
 * MVP 落盘 JSON，无第三方登录。
 */
import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface Profile {
  /** 游客为 deviceId；账号行则为 accountId */
  deviceId: string;
  accountId?: string;
  name: string;
  games: number;
  wins: number;
  totalNet: number;
}

interface Account {
  accountId: string;
  tokenHash: string;
  name: string;
  games: number;
  wins: number;
  totalNet: number;
  deviceIds: string[];
}

const DATA = join(process.cwd(), "data");
const PROFILE_FILE = join(DATA, "profiles.json");
const ACCOUNT_FILE = join(DATA, "accounts.json");

const profiles = new Map<string, Profile>();
const accounts = new Map<string, Account>();
/** deviceId → accountId */
const bindings = new Map<string, string>();
let saveTimer: NodeJS.Timeout | null = null;

load();

function load(): void {
  if (existsSync(PROFILE_FILE)) {
    try {
      const rows = JSON.parse(readFileSync(PROFILE_FILE, "utf8")) as Profile[];
      rows.forEach((p) => profiles.set(p.deviceId, p));
    } catch {
      console.warn("[捡红点] 战绩文件损坏，已忽略");
    }
  }
  if (existsSync(ACCOUNT_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(ACCOUNT_FILE, "utf8")) as {
        accounts: Account[];
        bindings: Record<string, string>;
      };
      (raw.accounts || []).forEach((a) => accounts.set(a.accountId, a));
      Object.entries(raw.bindings || {}).forEach(([d, a]) => bindings.set(d, a));
    } catch {
      console.warn("[捡红点] 账号文件损坏，已忽略");
    }
  }
}

function save(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DATA, { recursive: true });
      writeFileSync(
        PROFILE_FILE,
        JSON.stringify([...profiles.values()], null, 2)
      );
      writeFileSync(
        ACCOUNT_FILE,
        JSON.stringify(
          {
            accounts: [...accounts.values()],
            bindings: Object.fromEntries(bindings),
          },
          null,
          2
        )
      );
    } catch (e) {
      console.warn("[捡红点] 战绩落盘失败：", (e as Error).message);
    }
  }, 1000);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newId(bytes = 4): string {
  return randomBytes(bytes).toString("hex");
}

function emptyStats(name: string) {
  return { name, games: 0, wins: 0, totalNet: 0 };
}

/** 创建账号，token 仅返回一次，请客户端妥善保存 */
export function createAccount(name: string): {
  accountId: string;
  token: string;
  profile: Profile;
} {
  const accountId = newId(4);
  const token = newId(16);
  const n = (name || "玩家").slice(0, 12);
  const acc: Account = {
    accountId,
    tokenHash: hashToken(token),
    ...emptyStats(n),
    deviceIds: [],
  };
  accounts.set(accountId, acc);
  save();
  return {
    accountId,
    token,
    profile: toAccountProfile(acc),
  };
}

/**
 * 用账号凭证绑定当前设备：合并该设备游客战绩到账号，之后战绩记入账号。
 */
export function bindDevice(
  accountId: string,
  token: string,
  deviceId: string
): Profile {
  const acc = accounts.get(accountId);
  if (!acc || acc.tokenHash !== hashToken(token)) {
    throw new Error("账号或凭证无效");
  }
  if (!deviceId) throw new Error("缺少 deviceId");

  const prev = bindings.get(deviceId);
  if (prev && prev !== accountId) {
    const old = accounts.get(prev);
    if (old) old.deviceIds = old.deviceIds.filter((d) => d !== deviceId);
  }

  bindings.set(deviceId, accountId);
  if (!acc.deviceIds.includes(deviceId)) acc.deviceIds.push(deviceId);

  const guest = profiles.get(deviceId);
  if (guest) {
    acc.games += guest.games;
    acc.wins += guest.wins;
    acc.totalNet += guest.totalNet;
    if (guest.name) acc.name = guest.name;
    profiles.delete(deviceId);
  }
  save();
  return toAccountProfile(acc);
}

export function recordResult(
  deviceId: string,
  name: string,
  net: number
): void {
  const accountId = bindings.get(deviceId);
  if (accountId) {
    const acc = accounts.get(accountId);
    if (acc) {
      acc.name = name.slice(0, 12) || acc.name;
      acc.games += 1;
      if (net > 0) acc.wins += 1;
      acc.totalNet += net;
      save();
      return;
    }
  }
  const p = profiles.get(deviceId) ?? {
    deviceId,
    ...emptyStats(name),
  };
  p.name = name.slice(0, 12);
  p.games += 1;
  if (net > 0) p.wins += 1;
  p.totalNet += net;
  profiles.set(deviceId, p);
  save();
}

function toAccountProfile(acc: Account): Profile {
  return {
    deviceId: acc.accountId,
    accountId: acc.accountId,
    name: acc.name,
    games: acc.games,
    wins: acc.wins,
    totalNet: acc.totalNet,
  };
}

/** 排行榜：账号 + 未绑定游客，按累计净分降序 */
export function leaderboard(limit = 20): Profile[] {
  const rows: Profile[] = [
    ...[...accounts.values()].map(toAccountProfile),
    ...profiles.values(),
  ];
  return rows.sort((a, b) => b.totalNet - a.totalNet).slice(0, limit);
}

/** 按 deviceId 查：已绑定则返回账号战绩 */
export function getProfile(deviceId: string): Profile | undefined {
  const accountId = bindings.get(deviceId);
  if (accountId) {
    const acc = accounts.get(accountId);
    if (acc) return toAccountProfile(acc);
  }
  return profiles.get(deviceId);
}

export function getAccount(accountId: string): Profile | undefined {
  const acc = accounts.get(accountId);
  return acc ? toAccountProfile(acc) : undefined;
}

export function boundAccountId(deviceId: string): string | undefined {
  return bindings.get(deviceId);
}
