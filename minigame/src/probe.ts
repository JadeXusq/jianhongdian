/**
 * 联机链路探针：小游戏环境下 colyseus.js 能否连服、建房、收手牌。
 * 构建：MG_ENTRY=probe node minigame/build.mjs
 */
import { log } from "./boot";
import "./platform/polyfill";
import { Client } from "colyseus.js";
import { httpJson, platformName, storage } from "./platform";

declare const __WS_URL__: string;

const WS_URL = __WS_URL__;
const HTTP_URL = WS_URL.replace(/^ws/, "http");

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

function deviceId(): string {
  let id = storage.get("jhd.device");
  if (!id) {
    id = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")
    ).join("");
    storage.set("jhd.device", id);
  }
  return id;
}

async function main(): Promise<void> {
  log(`平台 ${platformName}，服务器 ${WS_URL}`);
  await httpJson(`${HTTP_URL}/api/health`);
  log("HTTP 健康检查通过");

  const client = new Client(endpoint(WS_URL));
  const room = await client.create<any>("game", {
    name: "小游戏探针",
    maxPlayers: 2,
    deviceId: deviceId(),
  });
  log(`WebSocket 已进房 ${room.roomId}`);

  room.onMessage("joined", (m: { seat: number; code: string }) => {
    log(`座位 ${m.seat}，房号 ${m.code}`);
    httpJson<{ roomId: string }>(`${HTTP_URL}/api/room/${m.code}`)
      .then((hit) => {
        if (hit.roomId !== room.roomId) throw new Error("房号查询结果不一致");
        room.send("addAi");
        room.send("ready", true);
      })
      .catch((e: Error) => log(`FAIL ${e.message}`));
  });
  room.onMessage("hand", (hand: number[]) => {
    log(`收到手牌 ${hand.length} 张`);
    if (hand.length === 12) {
      log("OK 技术验证通过");
      void room.leave(true);
    }
  });
  room.onMessage("*", () => undefined);
  room.onError((code, message) => log(`房间错误 ${code} ${message ?? ""}`));
}

main().catch((e: Error) => log(`FAIL ${e.message}`));
