/**
 * 联机冒烟测试：起 2 个真实 WebSocket 客户端 + 1 个 AI，
 * 用 AI 策略自动打完一整局，校验服务器同步的状态与结算。
 * 运行：npm run smoke -w server（需先启动服务器）
 */
import { Client, Room } from "colyseus.js";
import { bestTarget, chooseHandPlay, findTargets } from "@jhd/shared";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const HTTP = ENDPOINT.replace("ws://", "http://");

interface Bot {
  room: Room<any>;
  seat: number;
  hand: number[];
  name: string;
}

function attach(room: Room<any>, bot: Bot): void {
  room.onMessage("hand", (hand: number[]) => {
    bot.hand = hand;
  });
  room.onMessage("error", (e: { message: string }) => {
    throw new Error(`[${bot.name}] 服务器拒绝操作：${e.message}`);
  });
  // 动画事件本测试不关心，仅注册以消除未处理消息告警
  room.onMessage("events", () => {});
  room.onMessage("roundStart", () => {});
  room.onMessage("joined", () => {});
  room.onMessage("roundOver", () => {});

  // 轮到自己就按 AI 策略行动
  room.onStateChange((state: any) => {
    if (state.phase !== "PLAYING" || state.currentSeat !== bot.seat) return;
    const table: number[] = [...state.table];
    if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
      const targets = findTargets(state.pendingStockCard, table);
      if (targets.length)
        room.send("chooseTarget", { targetId: bestTarget(targets) });
      return;
    }
    if (!bot.hand.length) return;
    const move = chooseHandPlay(bot.hand, table);
    bot.hand = bot.hand.filter((c) => c !== move.cardId); // 本地先移除，避免重复出同一张
    room.send("play", move);
  });
}

async function main(): Promise<void> {
  const client = new Client(ENDPOINT);

  const hostRoom = await client.create<any>("game", {
    name: "甲",
    maxPlayers: 3,
  });
  const code: string = await new Promise((resolve) =>
    hostRoom.onMessage("joined", (m: { code: string }) => resolve(m.code))
  );
  console.log("房号", code);

  // 用房号查 roomId 再进房，验证房号加入链路
  const { roomId } = await fetch(`${HTTP}/api/room/${code}`).then((r) =>
    r.json()
  );
  const guestRoom = await new Client(ENDPOINT).joinById<any>(roomId, {
    name: "乙",
  });

  const host: Bot = { room: hostRoom, seat: 0, hand: [], name: "甲" };
  const guest: Bot = { room: guestRoom, seat: 1, hand: [], name: "乙" };
  attach(hostRoom, host);
  attach(guestRoom, guest);

  const finished = new Promise<any>((resolve) =>
    hostRoom.onMessage("roundOver", resolve)
  );

  hostRoom.send("addAi"); // 第三个座位交给 AI
  hostRoom.send("ready", true);
  guestRoom.send("ready", true);

  const result = await Promise.race([
    finished,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("对局超时未结束")), 60_000)
    ),
  ]);

  const sum = result.points.reduce((a: number, b: number) => a + b, 0);
  const netSum = result.net.reduce((a: number, b: number) => a + b, 0);
  console.log("得分", result.points, "底分", result.base, "净分", result.net);
  if (sum !== 240) throw new Error(`总分应为 240，实际 ${sum}`);
  if (netSum !== 0) throw new Error(`净分之和应为 0，实际 ${netSum}`);
  if (hostRoom.state.table.length !== 0) throw new Error("终局桌面应清空");
  if (hostRoom.state.stockCount !== 0) throw new Error("终局牌堆应为空");
  console.log("✅ 联机冒烟测试通过");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
