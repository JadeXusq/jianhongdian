/**
 * 移动端适配校验：模拟真实手机（触屏 + 移动 UA），分别验证竖屏与横屏表现。
 * 运行：URL=http://<IP>:5173/ PW=<playwright-core路径> node tools/mobileCheck.mjs
 */
import { homedir } from "os";
import { tapLogical } from "./canvasTap.mjs";

const pw = await import(process.env.PW ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;

const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const URL = process.env.URL ?? "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const browser = await chromium.launch({ executablePath: EXE });

/** 建一个模拟手机的上下文：触屏 + 移动 UA + 指定视口 */
const phone = (width, height) =>
  browser.newContext({
    viewport: { width, height },
    userAgent: IPHONE_UA,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });

// ---------- 竖屏：应软件旋转为横屏，而不是提示用户转屏 ----------
const portrait = await (await phone(390, 844)).newPage();
await portrait.goto(URL);
await sleep(900);
const rotState = await portrait.evaluate(() => ({
  uiRotated: document.getElementById("ui").classList.contains("rot"),
  transform: getComputedStyle(document.getElementById("ui")).transform,
}));
await portrait.screenshot({ path: "/tmp/jhd-m1-portrait.png" });
console.log("竖屏是否软件旋转：", rotState.uiRotated, rotState.transform);

// ---------- 横屏：应可正常游戏 ----------
const land = await (await phone(844, 390)).newPage();
await land.goto(URL);
await sleep(900);
const notRotated = await land.evaluate(
  () => !document.getElementById("ui").classList.contains("rot")
);
await land.screenshot({ path: "/tmp/jhd-m2-landscape-lobby.png" });
console.log("横屏是否不旋转：", notRotated);

// 用触摸开一局人机
await land.fill("#name", "手机");
await land.tap('#counts button[data-n="2"]');
await land.tap("#btn-create");
await land.waitForFunction(
  () => document.getElementById("room-code").textContent !== "------"
);
await land.tap("#btn-ai");
await sleep(400);
await land.screenshot({ path: "/tmp/jhd-m3-landscape-room.png" });
await land.tap("#btn-ready");
await sleep(2200);
await land.screenshot({ path: "/tmp/jhd-m4-landscape-table.png" });

// 手牌的实际可点面积（触屏建议 ≥44px）
const metrics = await land.evaluate(() => {
  const { view } = window.__jhd;
  const s = view.scale;
  const slots = [...view.handSlots.values()];
  const step = slots.length > 1 ? slots[1].x - slots[0].x : slots[0]?.w ?? 0;
  return {
    logicalW: Math.round(view.w),
    scale: +s.toFixed(3),
    cardW: Math.round((slots[0]?.w ?? 0) * s),
    cardH: Math.round((slots[0]?.w ?? 0) * 1.4 * s),
    tapWidth: Math.round(step * s), // 相邻牌重叠后每张的可点宽度
    handCount: slots.length,
  };
});
console.log("横屏手牌尺寸：", metrics);

// 触摸出牌是否生效
const before = await land.evaluate(() => window.__jhd.net.hand.length);
const handSlot = await land.evaluate(() => {
  const slot = [...window.__jhd.view.handSlots.values()].pop();
  return { x: slot.x + slot.w / 2, y: slot.y + slot.w * 0.7 };
});
const pos = await tapLogical(land, handSlot.x, handSlot.y);
await land.touchscreen.tap(pos.x, pos.y);
await sleep(450);
const after1 = await land.evaluate(() => ({
  hint: document.getElementById("turn-hint").classList.contains("hidden")
    ? null
    : document.getElementById("turn-hint").textContent,
  selected: window.__jhd.view.selected,
  targets: window.__jhd.view.targets.length,
  hand: window.__jhd.net.hand.length,
}));
console.log("第1次触摸后：", after1);
const hint = after1.hint;
if (hint?.includes("再点一次")) {
  await land.touchscreen.tap(pos.x, pos.y); // 二次确认弃牌
} else if (hint?.includes("选择要吃")) {
  // 多目标：再点高亮的桌面牌
  const target = await land.evaluate(() => {
    const { view } = window.__jhd;
    for (const [id, slot] of view.tableSlots)
      if (view.targets.includes(id))
        return { x: slot.x + slot.w / 2, y: slot.y + slot.w * 0.7 };
    return null;
  });
  if (target) {
    const t = await tapLogical(land, target.x, target.y);
    await land.touchscreen.tap(t.x, t.y);
  }
}
await sleep(1800);
const after = await land.evaluate(() => window.__jhd.net.hand.length);
console.log(
  "触摸出牌：手牌",
  before,
  "→",
  after,
  after < before ? "✅ 生效" : "❌ 无效"
);
await land.screenshot({ path: "/tmp/jhd-m5-landscape-played.png" });

// ---------- 多机型：各种屏幕比例下的铺满程度与可点尺寸 ----------
const DEVICES = [
  ["iPhone SE 横", 667, 375],
  ["iPhone 15 横", 852, 393],
  ["iPhone 15 Pro Max 横", 932, 430],
  ["Android 20:9 横", 900, 405],
  ["iPad mini 横", 1024, 768],
  ["iPad Pro 横", 1366, 1024],
  ["iPhone 15 竖（应软件旋转）", 393, 852],
];

for (const [name, w, h] of DEVICES) {
  const page = await (await phone(w, h)).newPage();
  await page.goto(URL);
  await sleep(700);
  const m = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const rotated =
      getComputedStyle(document.getElementById("ui")).transform !== "none";
    const vw = rotated ? c.clientHeight : c.clientWidth;
    const vh = rotated ? c.clientWidth : c.clientHeight;
    let lw = (vw / vh) * 720;
    let scale;
    if (lw < 1040) {
      lw = 1040;
      scale = vw / 1040;
    } else {
      if (lw > 1700) lw = 1700;
      scale = vh / 720;
    }
    // 黑边占比：0 表示完全铺满
    const used = (lw * scale * (720 * scale)) / (vw * vh);
    return {
      rotated,
      logicalW: Math.round(lw),
      scale: +scale.toFixed(3),
      fill: `${Math.round(used * 100)}%`,
    };
  });
  console.log(`${name.padEnd(24)} ${w}×${h} →`, m);
  await page.close();
}

await browser.close();
