/**
 * TODO-1b 验收：Cocos + Web 客户端 + AI 打完 1 轮
 * 运行：需 server@2567 + cocos build@5180
 *   PW=/tmp/jhd-shot/node_modules/playwright-core/index.js npx tsx tools/cocosNetRound.ts
 */
import { homedir } from "os";
import { Client } from "colyseus.js";
import { chooseHandPlay, bestTarget, findTargets } from "@jhd/shared";

async function main(): Promise<void> {
  const pw = await import(
    process.env.PW ?? "/tmp/jhd-shot/node_modules/playwright-core/index.js"
  );
  const chromium = pw.chromium ?? pw.default.chromium;
  const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`未捕获: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("http://localhost:5180/?manual=1", {
    waitUntil: "networkidle",
  });
  await sleep(3500);

  const code: string = await page.evaluate(async () => {
    const g = (window as any).__gameEntry;
    return await g.createHost("Cocos玩家", 3, false);
  });
  console.log("房号", code);

  const web = new Client("ws://localhost:2567");
  const { roomId } = await fetch(
    `http://localhost:2567/api/room/${code}`
  ).then((r) => r.json());
  const room = await web.joinById(roomId, {
    name: "Web玩家",
    deviceId: "web-bot-1b",
  });
  let webSeat = -1;
  let webHand: number[] = [];
  room.onMessage("joined", (m: { seat: number }) => {
    webSeat = m.seat;
  });
  room.onMessage("hand", (h: number[]) => {
    webHand = h;
  });
  room.onMessage("events", () => {});
  room.onMessage("roundStart", () => {});
  room.onMessage("error", (e: { message: string }) =>
    console.log("Web error", e)
  );
  let roundOver: any = null;
  room.onMessage("roundOver", (r: any) => {
    roundOver = r;
  });

  await page.evaluate(() => {
    const g = (window as any).__gameEntry;
    g.net.addAi();
    g.net.ready(true);
  });
  room.send("ready", true);

  for (let i = 0; i < 50; i++) {
    const st = await page.evaluate(() => {
      const g = (window as any).__gameEntry;
      return {
        phase: g.net.state?.phase,
        hand: g.net.hand?.length,
        table: g.net.state ? [...g.net.state.table].length : 0,
        stock: g.net.state?.stockCount,
        mySeat: g.net.mySeat,
      };
    });
    if (st.phase === "PLAYING" && st.hand > 0) {
      console.log("开局同步", st);
      break;
    }
    await sleep(200);
  }

  let turns = 0;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (!roundOver && Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      const g = (window as any).__gameEntry;
      const s = g.net.state;
      if (!s) return null;
      return {
        phase: s.phase,
        turnPhase: s.turnPhase,
        currentSeat: s.currentSeat,
        mySeat: g.net.mySeat,
        hand: g.net.hand.slice(),
        table: [...s.table],
        pending: s.pendingStockCard,
      };
    });

    if (snap?.phase === "PLAYING" && snap.currentSeat === snap.mySeat) {
      if (snap.turnPhase === "CHOOSE_STOCK_TARGET") {
        const targets = findTargets(snap.pending, snap.table);
        if (targets.length) {
          await page.evaluate(
            (tid) => (window as any).__gameEntry.net.chooseTarget(tid),
            bestTarget(targets)
          );
          turns++;
        }
      } else if (snap.hand.length) {
        const move = chooseHandPlay(snap.hand, snap.table);
        await page.evaluate((m) => {
          const g = (window as any).__gameEntry;
          g.net.play(m.cardId, m.targetId);
          g.net.hand = g.net.hand.filter((c: number) => c !== m.cardId);
        }, move);
        turns++;
      }
      await sleep(250);
      continue;
    }

    const st: any = room.state;
    if (st?.phase === "PLAYING" && st.currentSeat === webSeat) {
      const table = [...st.table];
      if (st.turnPhase === "CHOOSE_STOCK_TARGET") {
        const targets = findTargets(st.pendingStockCard, table);
        if (targets.length)
          room.send("chooseTarget", { targetId: bestTarget(targets) });
      } else if (webHand.length) {
        const move = chooseHandPlay(webHand, table);
        webHand = webHand.filter((c) => c !== move.cardId);
        room.send("play", move);
      }
      turns++;
      await sleep(250);
      continue;
    }

    await sleep(400);
  }

  const final = await page.evaluate(() => {
    const g = (window as any).__gameEntry;
    const s = g.net.state;
    const players = s
      ? [...s.players.values()].map((p: any) => ({
          name: p.name,
          seat: p.seat,
          points: p.points,
          handCount: p.handCount,
          isAi: p.isAi,
        }))
      : [];
    return {
      phase: s?.phase,
      stock: s?.stockCount,
      table: s ? [...s.table].length : 0,
      hand: g.net.hand.length,
      players,
    };
  });

  console.log("回合数", turns);
  console.log(
    "结算",
    roundOver && {
      round: roundOver.round,
      points: roundOver.points,
      net: roundOver.net,
      allDone: roundOver.allDone,
    }
  );
  console.log("最终同步", final);
  const realErrors = errors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("404") &&
      !e.includes("Error 1510")
  );
  console.log("报错", realErrors.slice(0, 6));

  await room.leave(true);
  await browser.close();

  if (!roundOver) throw new Error("未收到 roundOver");
  if (final.players.length !== 3) throw new Error("玩家数不是 3");
  if (!final.players.some((p: any) => p.isAi)) throw new Error("缺少 AI");
  if (realErrors.length) throw new Error(realErrors[0]);
  console.log("✅ TODO-1b 验收通过");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
