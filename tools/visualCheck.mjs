/**
 * 视觉与交互校验：驱动两个浏览器页面真人对战，逐步截图并收集控制台报错。
 * 复用系统已缓存的 Chromium，需先启动 server 与 client。
 * 运行：PW=/tmp/jhd-shot/node_modules/playwright-core/index.js node tools/visualCheck.mjs
 */
import { homedir } from "os";
import { tapLogical } from "./canvasTap.mjs";

// playwright-core 可安装在外部目录，避免为测试引入项目依赖
const pw = await import(process.env.PW ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;

const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
// 默认用 localhost；可传 URL=http://<局域网IP>:5173/ 验证非安全上下文（手机实际访问方式）
const URL = process.env.URL ?? "http://localhost:5173/";
const OUT = "/tmp/jhd";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXE });
// 每个玩家用独立上下文，使 localStorage 里的游客设备标识不同（模拟两台设备）
const viewport = { width: 1280, height: 720 };
const ctx = await browser.newContext({ viewport });
const ctx2 = await browser.newContext({ viewport });
const ctx3 = await browser.newContext({ viewport });
const errors = [];

function watch(page, tag) {
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(`[${tag}] ${m.text()}`)
  );
  page.on("pageerror", (e) => errors.push(`[${tag}] ${e.message}`));
  page.on(
    "response",
    (r) =>
      r.status() >= 400 && errors.push(`[${tag}] HTTP ${r.status()} ${r.url()}`)
  );
}

/** 画布逻辑坐标 → 屏幕坐标后点击 */
async function tap(page, lx, ly) {
  const p = await tapLogical(page, lx, ly);
  await page.mouse.click(p.x, p.y);
}

/** 借助 dev 调试钩子读取牌位与状态 */
const probe = (page) =>
  page.evaluate(() => {
    const { net, view } = window.__jhd;
    const center = (s) => ({ x: s.x + s.w / 2, y: s.y + s.w * 1.4 * 0.5 });
    return {
      myTurn:
        net.state?.phase === "PLAYING" && net.state.currentSeat === net.mySeat,
      turnPhase: net.state?.turnPhase,
      hand: [...view.handSlots.entries()].map(([id, s]) => ({
        id,
        ...center(s),
      })),
      table: [...view.tableSlots.entries()].map(([id, s]) => ({
        id,
        ...center(s),
      })),
      targets: view.targets,
      animating: view.animating,
      hint: document.getElementById("turn-hint").classList.contains("hidden")
        ? null
        : document.getElementById("turn-hint").textContent,
      resultShown: !document
        .getElementById("result")
        .classList.contains("hidden"),
      points: net.state
        ? [...net.state.players.values()].map((p) => p.points)
        : [],
      stock: net.state?.stockCount,
    };
  });

// ---------- 大厅 → 房间 ----------
const A = await ctx.newPage();
watch(A, "甲");
await A.goto(URL);
await sleep(700);
await A.screenshot({ path: `${OUT}-1-lobby.png` });

await A.fill("#name", "玩家甲");
await A.click('#counts button[data-n="2"]');
await A.click("#btn-create");
await A.waitForFunction(
  () => document.getElementById("room-code").textContent !== "------"
);
const code = await A.textContent("#room-code");
console.log("房号", code);
await sleep(400);
await A.screenshot({ path: `${OUT}-2-room.png` });

const B = await ctx2.newPage();
watch(B, "乙");
await B.goto(URL);
await B.fill("#name", "玩家乙");
B.once("dialog", (d) => d.accept(code));
await B.click("#btn-join");
await sleep(1200);
await A.bringToFront();
await sleep(300);
await A.screenshot({ path: `${OUT}-3-room-full.png` });

// ---------- 开局 ----------
await A.click("#btn-ready");
await B.click("#btn-ready");
await A.waitForFunction(
  () => document.getElementById("lobby").classList.contains("hidden"),
  {
    timeout: 8000,
  }
);
await sleep(1300);
await A.screenshot({ path: `${OUT}-4-table.png` });

// ---------- 自动对战 ----------
let shots = 0;
const roundStartAt = Date.now();
// 上限预留充足：每手牌有动画 + AI 间隔，循环会多次等待重试
for (let step = 0; step < 200; step++) {
  const [sa, sb] = [await probe(A), await probe(B)];
  if (sa.resultShown || sb.resultShown) break;
  const page = sa.myTurn ? A : sb.myTurn ? B : null;
  if (!page) {
    await sleep(400);
    continue;
  }
  const s = sa.myTurn ? sa : sb;
  if (s.animating) {
    await sleep(300);
    continue;
  }

  if (s.turnPhase === "CHOOSE_STOCK_TARGET") {
    const t = s.table.find((c) => s.targets.includes(c.id));
    if (t) await tap(page, t.x, t.y);
    await sleep(900);
    continue;
  }

  // 优先点一张能吃牌的：逐张试，读提示判断
  const card = s.hand[0];
  await tap(page, card.x, card.y);
  await sleep(350);
  const after = await probe(page);
  if (after.hint?.includes("再点一次")) {
    await tap(page, card.x, card.y);
  } else if (after.hint?.includes("选择要吃")) {
    const t = after.table.find((c) => after.targets.includes(c.id));
    if (t) await tap(page, t.x, t.y);
  }
  await sleep(1400); // 等自己的出牌+翻牌动画跑完
  if (++shots <= 4)
    await page.screenshot({ path: `${OUT}-5-play${shots}.png` });
}
console.log(`一局耗时 ${((Date.now() - roundStartAt) / 1000).toFixed(0)} 秒`);

await sleep(1200);
await A.screenshot({ path: `${OUT}-6-result.png` });
const fin = await probe(A);
console.log(
  "结算界面出现：",
  fin.resultShown,
  "牌堆剩余：",
  fin.stock,
  "得分：",
  fin.points
);

// ---------- 4 人局布局（自己 + 3 个电脑）----------
const D = await ctx3.newPage();
watch(D, "四人局");
await D.goto(URL);
await D.fill("#name", "玩家丙");
await D.click('#counts button[data-n="4"]');
await D.click("#btn-create");
await D.waitForFunction(
  () => document.getElementById("room-code").textContent !== "------"
);
await D.click("#btn-ai");
await D.click("#btn-ai");
await D.click("#btn-ai");
await sleep(500);
await D.screenshot({ path: `${OUT}-7-room4.png` });
await D.click("#btn-ready");
await sleep(2500);
await D.screenshot({ path: `${OUT}-8-table4.png` });

// ---------- 排行榜（验证前面对局的战绩已入库）----------
await A.bringToFront();
await A.click("#btn-exit");
await sleep(600);
await A.click("#btn-rank");
await sleep(800);
await A.screenshot({ path: `${OUT}-9-rank.png` });
const ranks = await A.evaluate(() =>
  Array.from(document.querySelectorAll("#rank-list .res")).map((el) =>
    el.textContent.trim().replace(/\s+/g, " ")
  )
);
console.log("排行榜：", ranks);

console.log("控制台报错：", errors.length ? errors : "无");
await browser.close();
