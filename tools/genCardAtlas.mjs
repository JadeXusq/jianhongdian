/**
 * 生成牌面图集（54 张牌 + 1 张牌背）→ 位图像素，消除各端系统字体差异。
 * 输出：
 *   client/public/card-atlas.png
 *   client/public/card-atlas.json
 *   cocos/assets/textures/card-atlas.png (+ .meta / json)
 *
 * 运行：PW=/tmp/jhd-shot/node_modules/playwright-core/index.js node tools/genCardAtlas.mjs
 */
import { homedir } from "os";
import { mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CW = 96;
const CH = Math.round(CW * 1.4); // 134
const COLS = 8;
const COUNT = 55; // 0..53 牌面，54 牌背
const ROWS = Math.ceil(COUNT / COLS);
const AW = COLS * CW;
const AH = ROWS * CH;

const pw = await import(
  process.env.PW ?? "/tmp/jhd-shot/node_modules/playwright-core/index.js"
);
const chromium = pw.chromium ?? pw.default.chromium;
const EXE = `${homedir()}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: AW, height: AH } });

const dataUrl = await page.evaluate(
  ({ CW, CH, COLS, COUNT, AW, AH }) => {
    const BLACK_JOKER = 52;
    const RED_JOKER = 53;
    const SUITS = ["S", "H", "D", "C"];
    const RANKS = [
      "A",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "J",
      "Q",
      "K",
    ];
    const SUIT_SYM = { S: "♠", H: "♥", D: "♦", C: "♣" };
    const C = {
      gold: "#c9a961",
      goldDim: "#7d6739",
      seal: "#b8352b",
      cream: "#f3ead6",
      ink: "#26262a",
      cardFace: "#f7f1e2",
      cardBack: "#6d2420",
    };

    function isJoker(id) {
      return id === BLACK_JOKER || id === RED_JOKER;
    }
    function isRed(id) {
      if (id === RED_JOKER) return true;
      if (id === BLACK_JOKER) return false;
      const s = SUITS[Math.floor(id / 13)];
      return s === "H" || s === "D";
    }
    function cardScore(id) {
      if (id === RED_JOKER) return 30;
      if (!isRed(id)) return 0;
      const rank = (id % 13) + 1;
      if (rank === 1) return 20;
      if (rank >= 9) return 10;
      return rank;
    }
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawFace(ctx, id, x, y, w, h) {
      const red = isRed(id);
      const color = red ? C.seal : C.ink;
      if (isJoker(id)) {
        ctx.fillStyle = id === RED_JOKER ? C.seal : C.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${w * 0.5}px "Songti SC", "STSong", "Noto Serif CJK SC", serif`;
        ctx.fillText("王", x + w / 2, y + h * 0.44);
        ctx.font = `${w * 0.17}px "Songti SC", "STSong", "Noto Serif CJK SC", serif`;
        ctx.fillText(
          id === RED_JOKER ? "大" : "小",
          x + w / 2,
          y + h * 0.72
        );
      } else {
        const suit = SUITS[Math.floor(id / 13)];
        const rank = (id % 13) + 1;
        const sym = SUIT_SYM[suit];
        const label = RANKS[rank - 1];
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${w * 0.26}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(label, x + w * 0.19, y + h * 0.14);
        ctx.font = `${w * 0.2}px serif`;
        ctx.fillText(sym, x + w * 0.19, y + h * 0.27);
        ctx.globalAlpha = 0.9;
        ctx.font = `${w * 0.52}px serif`;
        ctx.fillText(sym, x + w * 0.56, y + h * 0.6);
        ctx.globalAlpha = 1;
      }
      const score = cardScore(id);
      if (score > 0) {
        const cx = x + w * 0.19;
        const cy = y + h * 0.87;
        const rad = w * 0.14;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle = C.seal;
        ctx.fill();
        ctx.lineWidth = Math.max(1, w * 0.015);
        ctx.strokeStyle = C.gold;
        ctx.stroke();
        ctx.fillStyle = C.cream;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${w * 0.16}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(String(score), cx, cy + w * 0.005);
      }
    }

    function drawBack(ctx, x, y, w, h) {
      ctx.strokeStyle = "rgba(201,169,97,0.35)";
      ctx.lineWidth = Math.max(0.5, w * 0.012);
      const step = w * 0.18;
      for (let i = -h; i < w + h; i += step) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + h, y + h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
        ctx.stroke();
      }
      const s = w * 0.42;
      ctx.fillStyle = "rgba(201,169,97,0.9)";
      roundRect(ctx, x + (w - s) / 2, y + (h - s) / 2, s, s, s * 0.12);
      ctx.fill();
      ctx.fillStyle = C.cardBack;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${s * 0.62}px "Songti SC", "STSong", "Noto Serif CJK SC", serif`;
      ctx.fillText("红", x + w / 2, y + h / 2 + s * 0.02);
    }

    function drawCard(ctx, id, x, y, w, faceUp) {
      const h = w * 1.4;
      const r = w * 0.09;
      roundRect(ctx, x, y, w, h, r);
      if (faceUp) {
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, "#fdf8ec");
        g.addColorStop(1, C.cardFace);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = C.cardBack;
      }
      ctx.fill();
      ctx.save();
      roundRect(ctx, x, y, w, h, r);
      ctx.clip();
      if (faceUp) drawFace(ctx, id, x, y, w, h);
      else drawBack(ctx, x, y, w, h);
      ctx.restore();
      roundRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = faceUp ? "rgba(125,103,57,0.5)" : C.goldDim;
      ctx.lineWidth = Math.max(1, w * 0.018);
      ctx.stroke();
    }

    const canvas = document.createElement("canvas");
    canvas.width = AW;
    canvas.height = AH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, AW, AH);
    for (let i = 0; i < COUNT; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CW;
      const y = row * CH;
      if (i < 54) drawCard(ctx, i, x, y, CW, true);
      else drawCard(ctx, 0, x, y, CW, false);
    }
    return canvas.toDataURL("image/png");
  },
  { CW, CH, COLS, COUNT, AW, AH }
);

await browser.close();

const buf = Buffer.from(dataUrl.split(",")[1], "base64");
const meta = {
  cw: CW,
  ch: CH,
  cols: COLS,
  rows: ROWS,
  count: COUNT,
  backIndex: 54,
};

const clientPub = join(ROOT, "client/public");
mkdirSync(clientPub, { recursive: true });
writeFileSync(join(clientPub, "card-atlas.png"), buf);
writeFileSync(join(clientPub, "card-atlas.json"), JSON.stringify(meta, null, 2));

for (const dir of [
  join(ROOT, "cocos/assets/textures"),
  join(ROOT, "cocos/assets/resources"),
  join(ROOT, "cocos/build/web-mobile"),
]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "card-atlas.png"), buf);
  writeFileSync(join(dir, "card-atlas.json"), JSON.stringify(meta, null, 2));
}

writeFileSync(
  join(ROOT, "cocos/assets/textures/card-atlas.png.meta"),
  JSON.stringify(
    {
      ver: "4.0.24",
      importer: "image",
      imported: true,
      uuid: "a1b2c3d4-1111-4222-8333-444455556670",
      files: [".png", ".json"],
      subMetas: {},
      userData: {
        type: "sprite-frame",
        fixAlphaTransparencyArtifacts: false,
        hasAlpha: true,
      },
    },
    null,
    2
  )
);

console.log(
  `✅ 图集已生成 ${AW}x${AH}，${(buf.length / 1024).toFixed(1)} KB → client/public + cocos`
);
