/** 表情互动冒烟：两人进房，一方发表情另一方收到且不影响对局。 */
import { Client } from "colyseus.js";

async function main(): Promise<void> {
  const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
  const a = new Client(ENDPOINT);
  const roomA = await a.create("game", {
    name: "甲",
    maxPlayers: 2,
    deviceId: "emote-a",
  });
  let code = "";
  await new Promise<void>((r) =>
    roomA.onMessage("joined", (m: { code: string }) => {
      code = m.code;
      r();
    })
  );
  const HTTP = ENDPOINT.replace(/^ws/, "http");
  const { roomId } = await fetch(`${HTTP}/api/room/${code}`).then((x) =>
    x.json()
  );
  const roomB = await new Client(ENDPOINT).joinById(roomId, {
    name: "乙",
    deviceId: "emote-b",
  });
  roomA.onMessage("events", () => {});
  roomB.onMessage("events", () => {});
  roomA.onMessage("hand", () => {});
  roomB.onMessage("hand", () => {});
  roomA.onMessage("roundStart", () => {});
  roomB.onMessage("roundStart", () => {});
  roomA.onMessage("joined", () => {});
  roomB.onMessage("joined", () => {});

  const got = new Promise<{ name: string; id: string }>((resolve) => {
    roomB.onMessage("emote", resolve);
  });
  roomA.send("emote", { id: "加油" });
  const msg = await Promise.race([
    got,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("未收到表情")), 3000)
    ),
  ]);
  if (msg.id !== "加油" || msg.name !== "甲")
    throw new Error(`表情内容异常 ${JSON.stringify(msg)}`);

  roomA.send("emote", { id: "作弊码" }); // 非法应被忽略
  await new Promise((r) => setTimeout(r, 200));

  await roomA.leave(true);
  await roomB.leave(true);
  console.log("✅ 表情冒烟通过", msg);
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
