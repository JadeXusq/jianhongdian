/**
 * Cocos Web 构建产物：大厅 → 2 人房 + AI → 自动出牌跑完 1 轮。
 * 运行：需 server@2567 + cocos@5180
 *   PW=/tmp/jhd-shot/node_modules/playwright-core/index.js npx tsx tools/cocosCheck.ts
 */
import { homedir } from "os";
import { chooseHandPlay, bestTarget, findTargets } from "@jhd/shared";

async function main(): Promise<void> {
  const pw = await import(
    process.env.PW ?? "/tmp/jhd-shot/node_modules/playwright-core/index.js"
  );
  const chromium = pw.chromium ?? pw.default.chromium;
  const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const URL = process.env.URL ?? "http://localhost:5180/?auto=1";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();

  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`未捕获异常: ${e.message}`));

  await page.goto(URL, { waitUntil: "networkidle" });
  await sleep(4000);

  const state = await page.evaluate(() => {
    const cc = (window as any).cc;
    if (!cc) return { engine: false };
    return {
      engine: true,
      version: cc.ENGINE_VERSION,
      hasColyseus: typeof (window as any).Colyseus !== "undefined",
      hasEntry: !!(window as any).__gameEntry,
    };
  });
  console.log("引擎状态：", JSON.stringify(state, null, 1));

  await page.evaluate(() => {
    const g = (window as any).__gameEntry;
    if (!g) return;
    const prev = g.net.onRoundOver;
    g.net.onRoundOver = (r: any) => {
      prev?.(r);
      (window as any).__roundOver = r;
    };
  });

  let turns = 0;
  let roundOver = false;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => {
      const g = (window as any).__gameEntry;
      if (!g?.net?.state) return { wait: true } as any;
      const s = g.net.state;
      return {
        phase: s.phase,
        turnPhase: s.turnPhase,
        current: s.currentSeat,
        mySeat: g.net.mySeat,
        hand: g.net.hand.slice(),
        table: [...s.table],
        pending: s.pendingStockCard,
        stock: s.stockCount,
        roundOver: !!(window as any).__roundOver,
      };
    });

    if (info.roundOver) {
      roundOver = true;
      console.log(`✅ 对局结束！共 ${turns} 个回合，牌堆 ${info.stock}`);
      break;
    }
    if (info.wait || info.phase !== "PLAYING") {
      await sleep(400);
      continue;
    }
    if (info.current !== info.mySeat) {
      await sleep(400);
      continue;
    }

    if (info.turnPhase === "CHOOSE_STOCK_TARGET") {
      const targets = findTargets(info.pending, info.table);
      if (targets.length) {
        await page.evaluate(
          (tid) => (window as any).__gameEntry.net.chooseTarget(tid),
          bestTarget(targets)
        );
        turns++;
      }
    } else if (info.hand.length) {
      const move = chooseHandPlay(info.hand, info.table);
      await page.evaluate((m) => {
        const g = (window as any).__gameEntry;
        g.net.play(m.cardId, m.targetId);
        g.net.hand = g.net.hand.filter((c: number) => c !== m.cardId);
      }, move);
      turns++;
    }
    await sleep(300);
  }

  await sleep(1000);
  await page.screenshot({ path: "/tmp/jhd-cocos-1.png" });

  const fin = await page.evaluate(() => {
    const g = (window as any).__gameEntry;
    const s = g?.net?.state;
    const r = (window as any).__roundOver;
    return {
      phase: s?.phase,
      stock: s?.stockCount,
      table: s ? [...s.table].length : 0,
      points: r?.points,
      net: r?.net,
    };
  });
  console.log("最终状态：", fin);
  const realErrors = errors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("404") &&
      !e.includes("Error 1510")
  );
  console.log(
    "控制台报错：",
    realErrors.length ? realErrors.slice(0, 5) : "无"
  );

  await browser.close();
  if (!roundOver) throw new Error("未收到 roundOver");
  if (realErrors.length) throw new Error(realErrors[0]);
  console.log("✅ cocosCheck 通过");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
