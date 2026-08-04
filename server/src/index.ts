import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./GameRoom";
import { resolveCode } from "./roomCodes";
import {
  bindDevice,
  boundAccountId,
  createAccount,
  getAccount,
  getProfile,
  leaderboard,
} from "./store";

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// 快速匹配按人数分池，避免 2 人局和 4 人局混排
gameServer.define("game", GameRoom).filterBy(["maxPlayers"]);

/** 房号 → roomId，客户端拿到后用 joinById 进房 */
app.get("/api/room/:code", (req, res) => {
  const roomId = resolveCode(req.params.code);
  if (!roomId) return res.status(404).json({ error: "房间不存在" });
  res.json({ roomId });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

/** 排行榜：按累计净分降序 */
app.get("/api/leaderboard", (_req, res) => res.json(leaderboard()));

/** 游客/绑定后账号战绩（传 deviceId） */
app.get("/api/profile/:deviceId", (req, res) => {
  res.json(getProfile(req.params.deviceId) ?? null);
});

/** 创建本地账号（返回 accountId + token，token 仅此一次） */
app.post("/api/account/create", (req, res) => {
  const name = String(req.body?.name || "玩家").slice(0, 12);
  res.json(createAccount(name));
});

/** 绑定设备到账号并合并游客战绩 */
app.post("/api/account/bind", (req, res) => {
  try {
    const accountId = String(req.body?.accountId || "");
    const token = String(req.body?.token || "");
    const deviceId = String(req.body?.deviceId || "");
    const profile = bindDevice(accountId, token, deviceId);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** 当前设备是否已绑定 */
app.get("/api/account/bound/:deviceId", (req, res) => {
  const accountId = boundAccountId(req.params.deviceId);
  res.json({
    accountId: accountId ?? null,
    profile: accountId
      ? getAccount(accountId)
      : getProfile(req.params.deviceId) ?? null,
  });
});

/** 查询账号战绩 */
app.get("/api/account/:accountId", (req, res) => {
  res.json(getAccount(req.params.accountId) ?? null);
});

gameServer.listen(PORT).then(() => {
  console.log(`[捡红点] 服务器已启动 port=${PORT}`);
});
