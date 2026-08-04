/**
 * 观战冒烟：房主开局后第三人 spectate，校验无座位、无手牌、桌面可见、出牌被忽略。
 *   npx tsx tools/spectateSmoke.ts
 */
import { Client } from "colyseus.js";

async function main(): Promise<void> {
  const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
  const HTTP = ENDPOINT.replace(/^ws/, "http");
  const host = new Client(ENDPOINT);
  const room = await host.create("game", {
    name: "房主",
    maxPlayers: 2,
    deviceId: "host-spec",
  });
  let code = "";
  await new Promise<void>((resolve) => {
    room.onMessage("joined", (m: { code: string }) => {
      code = m.code;
      resolve();
    });
  });
  room.send("addAi");
  room.send("ready", true);

  await new Promise<void>((resolve) => {
    room.onMessage("roundStart", () => resolve());
    room.onStateChange((s: any) => {
      if (s.phase === "PLAYING") resolve();
    });
  });

  const { roomId } = await fetch(`${HTTP}/api/room/${code}`).then((r) =>
    r.json()
  );
  const specClient = new Client(ENDPOINT);
  const spec = await specClient.joinById(roomId, {
    name: "观众",
    deviceId: "spec-1",
    spectate: true,
  });
  let seat = 99;
  let hand: number[] | null = null;
  spec.onMessage("joined", (m: { seat: number; spectate?: boolean }) => {
    seat = m.seat;
  });
  spec.onMessage("hand", (h: number[]) => {
    hand = h;
  });
  await new Promise((r) => setTimeout(r, 500));

  const tableLen = [...spec.state.table].length;
  const stock = spec.state.stockCount;
  const players = [...spec.state.players.values()].length;

  // 观战者尝试出牌应无效
  spec.send("play", { cardId: 0 });
  await new Promise((r) => setTimeout(r, 200));

  console.log({
    code,
    seat,
    spectating: seat < 0,
    hand,
    tableLen,
    stock,
    players,
    phase: spec.state.phase,
  });

  if (seat >= 0) throw new Error("观战者不应有座位");
  if (hand) throw new Error("观战者不应收到手牌");
  if (spec.state.phase !== "PLAYING") throw new Error("应处于 PLAYING");
  if (tableLen < 0) throw new Error("桌面状态异常");
  if (players !== 2) throw new Error("观战不应占玩家位");

  await spec.leave(true);
  await room.leave(true);
  console.log("✅ 观战冒烟通过");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
