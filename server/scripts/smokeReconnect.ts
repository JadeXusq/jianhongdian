/**
 * 断线重连验证：对局中让一名玩家非正常掉线，确认
 * 1) AI 临时托管使对局不卡住  2) 重连后恢复座位并重新收到手牌  3) 对局仍能正常结算。
 * 运行：npm run smoke:reconnect -w server（需先启动服务器）
 */
import { Client, Room } from "colyseus.js";
import { bestTarget, chooseHandPlay, findTargets } from "@jhd/shared";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";

/** 让房间在轮到自己时自动按 AI 策略行动 */
function autoPlay(
  room: Room<any>,
  seat: number,
  hand: { cards: number[] }
): void {
  room.onMessage("hand", (h: number[]) => {
    hand.cards = h;
  });
  room.onMessage("error", (e: { message: string }) =>
    console.error("服务器拒绝：", e.message)
  );
  ["events", "roundStart", "roundOver", "joined"].forEach((t) =>
    room.onMessage(t, () => {})
  );
  room.onStateChange((state: any) => {
    if (state.phase !== "PLAYING" || state.currentSeat !== seat) return;
    const table = [...state.table];
    if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
      const targets = findTargets(state.pendingStockCard, table);
      if (targets.length)
        room.send("chooseTarget", { targetId: bestTarget(targets) });
      return;
    }
    if (!hand.cards.length) return;
    const move = chooseHandPlay(hand.cards, table);
    hand.cards = hand.cards.filter((c) => c !== move.cardId);
    room.send("play", move);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const hostRoom = await new Client(ENDPOINT).create<any>("game", {
    name: "甲",
    maxPlayers: 3,
  });
  const guestClient = new Client(ENDPOINT);
  let guestRoom = await guestClient.joinById<any>(hostRoom.roomId, {
    name: "乙",
  });

  const hostHand = { cards: [] as number[] };
  const guestHand = { cards: [] as number[] };
  autoPlay(hostRoom, 0, hostHand);
  autoPlay(guestRoom, 1, guestHand);

  const finished = new Promise<any>((resolve) =>
    hostRoom.onMessage("roundOver", resolve)
  );
  hostRoom.send("addAi");
  hostRoom.send("ready", true);
  guestRoom.send("ready", true);
  await sleep(1500); // 让对局先进行几个回合

  const token = guestRoom.reconnectionToken;
  const stockAtDisconnect = hostRoom.state.stockCount;
  console.log("模拟乙掉线…");
  await guestRoom.leave(false); // consented=false → 触发服务器保留座位
  await sleep(2500); // 期间应由 AI 托管推进对局
  if (hostRoom.state.stockCount >= stockAtDisconnect)
    throw new Error("掉线期间对局应由 AI 推进");
  console.log(
    `✅ 托管生效，牌堆 ${stockAtDisconnect} → ${hostRoom.state.stockCount}`
  );

  guestRoom = await guestClient.reconnect<any>(token);
  const handAfter = new Promise<number[]>((resolve) =>
    guestRoom.onMessage("hand", resolve)
  );
  autoPlay(guestRoom, 1, guestHand);
  const restored = await Promise.race([
    handAfter,
    sleep(5000).then(() => null),
  ]);
  if (!restored) throw new Error("重连后未收到手牌");
  console.log(`✅ 重连成功，恢复手牌 ${restored.length} 张`);

  await sleep(300); // 等状态补丁同步到房主端再校验
  const guest = [...(hostRoom.state.players as any).values()].find(
    (p: any) => p.seat === 1
  );
  if (!guest.connected) throw new Error("重连后 connected 应为 true");
  if (guest.isAi) throw new Error("重连后不应被永久标记为 AI");

  const result = await Promise.race([
    finished,
    sleep(60_000).then(() => {
      throw new Error("对局超时未结束");
    }),
  ]);
  const sum = result.points.reduce((a: number, b: number) => a + b, 0);
  if (sum !== 240) throw new Error(`总分应为 240，实际 ${sum}`);
  console.log("得分", result.points, "净分", result.net);
  console.log("✅ 断线重连测试通过");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
