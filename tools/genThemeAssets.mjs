/**
 * 生成主题贴图：牌背 / 桌布平铺 / 预览缩略图
 * 输出 client/public/themes/ 与 cocos/assets/resources/themes/
 * 运行：node tools/genThemeAssets.mjs
 */
import { deflateSync } from "zlib";
import { mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_WEB = join(ROOT, "client/public/themes");
const OUT_COCOS = join(ROOT, "cocos/assets/resources/themes");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function px(rgba, w, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w) return;
  const h = rgba.length / (w * 4);
  if (y >= h) return;
  const i = (y * w + x) * 4;
  const sa = a / 255;
  rgba[i] = Math.round(rgba[i] * (1 - sa) + r * sa);
  rgba[i + 1] = Math.round(rgba[i + 1] * (1 - sa) + g * sa);
  rgba[i + 2] = Math.round(rgba[i + 2] * (1 - sa) + b * sa);
  rgba[i + 3] = Math.min(255, rgba[i + 3] + a);
}

function fill(rgba, w, h, r, g, b, a = 255) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = a;
  }
}

function fillRect(rgba, w, x0, y0, rw, rh, r, g, b, a = 255) {
  for (let y = y0; y < y0 + rh; y++)
    for (let x = x0; x < x0 + rw; x++) px(rgba, w, x, y, r, g, b, a);
}

function line(rgba, w, x0, y0, x1, y1, r, g, b, a = 180) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    px(rgba, w, x, y, r, g, b, a);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function circle(rgba, w, cx, cy, rad, r, g, b, a = 255, fillIt = true) {
  const r2 = rad * rad;
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++) {
      const d = x * x + y * y;
      if (fillIt ? d <= r2 : Math.abs(d - r2) < rad * 1.2)
        px(rgba, w, cx + x, cy + y, r, g, b, a);
    }
}

function roundRectBorder(rgba, w, x, y, rw, rh, rad, r, g, b, a) {
  for (let i = 0; i < rw; i++) {
    px(rgba, w, x + i, y, r, g, b, a);
    px(rgba, w, x + i, y + rh - 1, r, g, b, a);
  }
  for (let j = 0; j < rh; j++) {
    px(rgba, w, x, y + j, r, g, b, a);
    px(rgba, w, x + rw - 1, y + j, r, g, b, a);
  }
  void rad;
}

function stampChar(rgba, w, cx, cy, scale, r, g, b, a, kind) {
  // 简化印章：菱形底 + 竖线/点构成「红」感或主题符号
  const s = scale;
  if (kind === "seal") {
    fillRect(rgba, w, cx - s, cy - s, s * 2, s * 2, r, g, b, a);
    fillRect(
      rgba,
      w,
      cx - Math.floor(s * 0.55),
      cy - Math.floor(s * 0.7),
      Math.floor(s * 1.1),
      Math.floor(s * 0.22),
      40,
      20,
      20,
      220
    );
    fillRect(
      rgba,
      w,
      cx - Math.floor(s * 0.15),
      cy - Math.floor(s * 0.45),
      Math.floor(s * 0.3),
      Math.floor(s * 1.1),
      40,
      20,
      20,
      220
    );
    fillRect(
      rgba,
      w,
      cx - Math.floor(s * 0.5),
      cy + Math.floor(s * 0.15),
      Math.floor(s * 1.0),
      Math.floor(s * 0.2),
      40,
      20,
      20,
      220
    );
  } else if (kind === "heart") {
    circle(rgba, w, cx - Math.floor(s * 0.35), cy - Math.floor(s * 0.15), Math.floor(s * 0.4), r, g, b, a);
    circle(rgba, w, cx + Math.floor(s * 0.35), cy - Math.floor(s * 0.15), Math.floor(s * 0.4), r, g, b, a);
    for (let i = 0; i < s; i++) {
      const t = i / s;
      const hw = Math.floor(s * (1 - t));
      fillRect(rgba, w, cx - hw, cy + Math.floor(s * 0.1) + i, hw * 2, 1, r, g, b, a);
    }
  } else if (kind === "moon") {
    circle(rgba, w, cx, cy, Math.floor(s * 0.85), r, g, b, a);
    circle(
      rgba,
      w,
      cx + Math.floor(s * 0.35),
      cy - Math.floor(s * 0.1),
      Math.floor(s * 0.7),
      30,
      70,
      110,
      255
    );
  }
}

function drawCardBack(theme) {
  const W = 140;
  const H = 196;
  const rgba = Buffer.alloc(W * H * 4);
  if (theme === "jade") {
    fill(rgba, W, H, 109, 36, 32);
    for (let i = -H; i < W + H; i += 18) {
      line(rgba, W, i, 0, i + H, H, 201, 169, 97, 70);
      line(rgba, W, i, H, i + H, 0, 201, 169, 97, 70);
    }
    fillRect(rgba, W, 10, 10, W - 20, H - 20, 90, 28, 24, 90);
    roundRectBorder(rgba, W, 8, 8, W - 16, H - 16, 8, 201, 169, 97, 200);
    roundRectBorder(rgba, W, 16, 16, W - 32, H - 32, 6, 201, 169, 97, 120);
    stampChar(rgba, W, 70, 98, 28, 201, 169, 97, 230, "seal");
  } else if (theme === "anime") {
    fill(rgba, W, H, 107, 63, 160);
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = Math.round(107 + 40 * Math.sin(t * 6));
      const g = Math.round(63 + 30 * t);
      const b = Math.round(160 + 20 * Math.cos(t * 4));
      for (let x = 0; x < W; x++) {
        if ((x + y) % 7 === 0) px(rgba, W, x, y, 255, 141, 199, 40);
        else if (y % 3 === 0) px(rgba, W, x, y, r, g, b, 35);
      }
    }
    for (let i = 0; i < 28; i++) {
      const x = ((i * 47) % (W - 20)) + 10;
      const y = ((i * 73) % (H - 20)) + 10;
      const s = 1 + (i % 3);
      circle(rgba, W, x, y, s, 255, 220, 240, 180);
    }
    roundRectBorder(rgba, W, 8, 8, W - 16, H - 16, 8, 255, 141, 199, 220);
    stampChar(rgba, W, 70, 98, 30, 255, 120, 170, 240, "heart");
  } else {
    fill(rgba, W, H, 30, 77, 123);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = ((x * 12 + y * 7) ^ (x * y)) & 255;
        if (n > 248) px(rgba, W, x, y, 180, 230, 255, 200);
        else if (n > 242) px(rgba, W, x, y, 94, 200, 255, 120);
      }
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const x0 = 70 + Math.round(Math.cos(ang) * 42);
      const y0 = 98 + Math.round(Math.sin(ang) * 58);
      line(rgba, W, 70, 98, x0, y0, 94, 200, 255, 50);
    }
    roundRectBorder(rgba, W, 8, 8, W - 16, H - 16, 8, 94, 200, 255, 200);
    stampChar(rgba, W, 70, 98, 26, 200, 230, 255, 230, "moon");
  }
  return encodePng(W, H, rgba);
}

function drawFelt(theme) {
  const W = 256;
  const H = 256;
  const rgba = Buffer.alloc(W * H * 4);
  if (theme === "jade") {
    fill(rgba, W, H, 28, 76, 59);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = ((x >> 3) ^ (y >> 3)) & 1;
        if (v) px(rgba, W, x, y, 18, 55, 42, 40);
        if ((x + y * 2) % 37 === 0) px(rgba, W, x, y, 201, 169, 97, 18);
      }
    for (let i = 0; i < W; i += 32)
      for (let j = 0; j < H; j += 32) {
        line(rgba, W, i, j + 16, i + 16, j, 201, 169, 97, 22);
        line(rgba, W, i + 16, j, i + 32, j + 16, 201, 169, 97, 22);
      }
  } else if (theme === "anime") {
    fill(rgba, W, H, 61, 42, 109);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = Math.sin(x * 0.04) * Math.cos(y * 0.035);
        if (t > 0.6) px(rgba, W, x, y, 255, 141, 199, 28);
        else if (((x * 13 + y * 17) & 255) > 250)
          px(rgba, W, x, y, 255, 240, 250, 160);
      }
  } else {
    fill(rgba, W, H, 22, 58, 95);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = (x * 31 + y * 17 + ((x ^ y) << 1)) & 255;
        if (n > 252) px(rgba, W, x, y, 200, 235, 255, 180);
        else if (n > 246) px(rgba, W, x, y, 94, 200, 255, 70);
        if ((x & 63) === 0 || (y & 63) === 0) px(rgba, W, x, y, 10, 30, 50, 25);
      }
  }
  return encodePng(W, H, rgba);
}

function drawPreview(theme) {
  const W = 160;
  const H = 96;
  const rgba = Buffer.alloc(W * H * 4);
  const felt = {
    jade: [28, 76, 59],
    anime: [61, 42, 109],
    night: [22, 58, 95],
  }[theme];
  const accent = {
    jade: [201, 169, 97],
    anime: [255, 141, 199],
    night: [94, 200, 255],
  }[theme];
  const back = {
    jade: [109, 36, 32],
    anime: [107, 63, 160],
    night: [30, 77, 123],
  }[theme];
  fill(rgba, W, H, felt[0], felt[1], felt[2]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - W / 2, y - H / 2) / 90;
      if (d > 0.7) px(rgba, W, x, y, 0, 0, 0, Math.floor((d - 0.7) * 120));
    }
  fillRect(rgba, W, 18, 16, 48, 68, back[0], back[1], back[2]);
  roundRectBorder(rgba, W, 18, 16, 48, 68, 4, accent[0], accent[1], accent[2], 220);
  fillRect(rgba, W, 28, 36, 28, 28, accent[0], accent[1], accent[2], 200);
  fillRect(rgba, W, 78, 28, 64, 10, accent[0], accent[1], accent[2], 180);
  fillRect(rgba, W, 78, 48, 50, 8, 243, 234, 214, 160);
  fillRect(rgba, W, 78, 64, 40, 8, 243, 234, 214, 100);
  roundRectBorder(rgba, W, 2, 2, W - 4, H - 4, 4, accent[0], accent[1], accent[2], 160);
  return encodePng(W, H, rgba);
}

mkdirSync(OUT_WEB, { recursive: true });
mkdirSync(OUT_COCOS, { recursive: true });

const themes = ["jade", "anime", "night"];
const kinds = [
  ["back", drawCardBack],
  ["felt", drawFelt],
  ["preview", drawPreview],
];

for (const id of themes) {
  for (const [kind, fn] of kinds) {
    const name = `${id}-${kind}.png`;
    const buf = fn(id);
    const webPath = join(OUT_WEB, name);
    writeFileSync(webPath, buf);
    copyFileSync(webPath, join(OUT_COCOS, name));
    console.log("wrote", name, buf.length);
  }
}

console.log("done →", OUT_WEB, OUT_COCOS);
