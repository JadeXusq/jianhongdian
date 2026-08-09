/**
 * 生成主题贴图：牌背 / 桌布平铺 / 预览缩略图（三套风格拉开）
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
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= w) return;
  const h = (rgba.length / (w * 4)) | 0;
  if (y >= h) return;
  const i = (y * w + x) * 4;
  const sa = a / 255;
  rgba[i] = (rgba[i] * (1 - sa) + r * sa + 0.5) | 0;
  rgba[i + 1] = (rgba[i + 1] * (1 - sa) + g * sa + 0.5) | 0;
  rgba[i + 2] = (rgba[i + 2] * (1 - sa) + b * sa + 0.5) | 0;
  rgba[i + 3] = Math.min(255, rgba[i + 3] + a);
}

function fill(rgba, w, h, r, g, b) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
}

function fillRect(rgba, w, x0, y0, rw, rh, r, g, b, a = 255) {
  for (let y = y0; y < y0 + rh; y++)
    for (let x = x0; x < x0 + rw; x++) px(rgba, w, x, y, r, g, b, a);
}

function line(rgba, w, x0, y0, x1, y1, r, g, b, a = 180, thick = 1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    for (let t = 0; t < thick; t++) {
      px(rgba, w, x + t, y, r, g, b, a);
      px(rgba, w, x, y + t, r, g, b, a);
    }
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
      if (fillIt ? d <= r2 : d <= r2 && d >= (rad - 1.4) * (rad - 1.4))
        px(rgba, w, cx + x, cy + y, r, g, b, a);
    }
}

function star(rgba, w, cx, cy, rOut, rIn, r, g, b, a) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? rOut : rIn;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  for (let y = cy - rOut; y <= cy + rOut; y++)
    for (let x = cx - rOut; x <= cx + rOut; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
      if (inside) px(rgba, w, x, y, r, g, b, a);
    }
}

function frame(rgba, w, h, m, r, g, b, a, thick = 2) {
  for (let t = 0; t < thick; t++) {
    fillRect(rgba, w, m + t, m + t, w - 2 * (m + t), 1, r, g, b, a);
    fillRect(rgba, w, m + t, h - m - 1 - t, w - 2 * (m + t), 1, r, g, b, a);
    fillRect(rgba, w, m + t, m + t, 1, h - 2 * (m + t), r, g, b, a);
    fillRect(rgba, w, w - m - 1 - t, m + t, 1, h - 2 * (m + t), r, g, b, a);
  }
}

function drawCardBack(theme) {
  const W = 140;
  const H = 196;
  const rgba = Buffer.alloc(W * H * 4);

  if (theme === "jade") {
    fill(rgba, W, H, 92, 28, 26);
    for (let i = -H; i < W + H; i += 14)
      for (let k = 0; k < 2; k++) {
        line(rgba, W, i + k, 0, i + H + k, H, 201, 169, 97, 55);
        line(rgba, W, i + k, H, i + H + k, 0, 201, 169, 97, 55);
      }
    fillRect(rgba, W, 14, 14, W - 28, H - 28, 70, 22, 20, 120);
    frame(rgba, W, H, 8, 201, 169, 97, 220, 2);
    frame(rgba, W, H, 18, 201, 169, 97, 120, 1);
    // 回纹角
    for (const [cx, cy, sx, sy] of [
      [28, 28, 1, 1],
      [W - 28, 28, -1, 1],
      [28, H - 28, 1, -1],
      [W - 28, H - 28, -1, -1],
    ]) {
      line(rgba, W, cx, cy + sy * 16, cx, cy, 201, 169, 97, 200, 2);
      line(rgba, W, cx, cy, cx + sx * 16, cy, 201, 169, 97, 200, 2);
    }
    fillRect(rgba, W, 48, 72, 44, 52, 201, 169, 97, 235);
    fillRect(rgba, W, 54, 78, 32, 40, 92, 28, 26, 255);
    fillRect(rgba, W, 60, 86, 20, 6, 201, 169, 97, 255);
    fillRect(rgba, W, 67, 92, 6, 22, 201, 169, 97, 255);
  } else if (theme === "anime") {
    // 粉紫渐变条带 + 大心 + 星星
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = (130 + 40 * Math.sin(t * 5)) | 0;
      const g = (70 + 50 * t) | 0;
      const b = (190 - 20 * t) | 0;
      for (let x = 0; x < W; x++) {
        const band = Math.sin((x + y) * 0.08) > 0.3;
        px(rgba, W, x, y, band ? r + 30 : r, band ? g + 20 : g, band ? b : b - 10, 255);
      }
    }
    for (let i = 0; i < 18; i++) {
      const x = 12 + ((i * 53) % (W - 24));
      const y = 12 + ((i * 79) % (H - 24));
      star(rgba, W, x, y, 3 + (i % 3), 1.2, 255, 230, 245, 200);
    }
    frame(rgba, W, H, 6, 255, 160, 210, 255, 3);
    frame(rgba, W, H, 14, 255, 220, 240, 160, 1);
    // 大心
    const cx = 70;
    const cy = 92;
    circle(rgba, W, cx - 16, cy - 8, 18, 255, 110, 170, 255);
    circle(rgba, W, cx + 16, cy - 8, 18, 255, 110, 170, 255);
    for (let i = 0; i < 36; i++) {
      const t = i / 36;
      const hw = ((1 - t) * 34) | 0;
      fillRect(rgba, W, cx - hw, cy + 6 + i, hw * 2, 1, 255, 110, 170, 255);
    }
    circle(rgba, W, cx, cy + 4, 10, 255, 240, 250, 220);
  } else {
    // 夜空：深渐变 + 星云带 + 大月
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = (12 + 18 * t) | 0;
      const g = (28 + 40 * t) | 0;
      const b = (55 + 60 * t) | 0;
      for (let x = 0; x < W; x++) px(rgba, W, x, y, r, g, b, 255);
    }
    for (let i = 0; i < 80; i++) {
      const x = (i * 47) % W;
      const y = (i * 91) % H;
      const s = 1 + (i % 3);
      px(rgba, W, x, y, 200, 235, 255, 220);
      if (s > 1) circle(rgba, W, x, y, s, 160, 220, 255, 160);
    }
    // 星云弧
    for (let a = 0; a < 120; a++) {
      const ang = (a / 120) * Math.PI;
      const x = 70 + Math.cos(ang) * 48;
      const y = 110 + Math.sin(ang) * 28;
      circle(rgba, W, x | 0, y | 0, 2, 80, 160, 220, 40);
    }
    frame(rgba, W, H, 7, 94, 200, 255, 220, 2);
    // 六边形框
    const hx = [70, 100, 100, 70, 40, 40];
    const hy = [14, 48, 148, 182, 148, 48];
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      line(rgba, W, hx[i], hy[i], hx[j], hy[j], 94, 200, 255, 100, 1);
    }
    circle(rgba, W, 70, 98, 28, 210, 235, 255, 230);
    circle(rgba, W, 82, 92, 22, 18, 50, 90, 255);
    star(rgba, W, 52, 70, 5, 2, 180, 230, 255, 220);
  }
  return encodePng(W, H, rgba);
}

function drawFelt(theme) {
  const W = 256;
  const H = 256;
  const rgba = Buffer.alloc(W * H * 4);
  if (theme === "jade") {
    fill(rgba, W, H, 22, 68, 52);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const cell = ((x >> 4) ^ (y >> 4)) & 1;
        if (cell) px(rgba, W, x, y, 14, 48, 36, 70);
      }
    for (let i = 0; i < W; i += 28)
      for (let j = 0; j < H; j += 28) {
        line(rgba, W, i, j + 14, i + 14, j, 201, 169, 97, 45, 1);
        line(rgba, W, i + 14, j, i + 28, j + 14, 201, 169, 97, 45, 1);
        line(rgba, W, i + 14, j, i, j + 14, 201, 169, 97, 28, 1);
        line(rgba, W, i + 14, j, i + 28, j + 14, 201, 169, 97, 28, 1);
      }
  } else if (theme === "anime") {
    fill(rgba, W, H, 72, 42, 128);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const wave = Math.sin(x * 0.05) * Math.cos(y * 0.04);
        if (wave > 0.35) px(rgba, W, x, y, 255, 130, 190, 55);
        if (((x * 17 + y * 23) & 255) > 248) {
          star(rgba, W, x, y, 2, 0.8, 255, 240, 250, 180);
        }
      }
    for (let i = 0; i < W; i += 40)
      for (let j = 0; j < H; j += 40)
        circle(rgba, W, i + 20, j + 20, 10, 255, 160, 210, 28);
  } else {
    fill(rgba, W, H, 10, 28, 52);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = (x * 31 + y * 17 + ((x ^ y) << 2)) & 255;
        if (n > 250) px(rgba, W, x, y, 220, 240, 255, 220);
        else if (n > 242) px(rgba, W, x, y, 94, 200, 255, 100);
        if ((x + y) % 48 === 0) px(rgba, W, x, y, 40, 90, 140, 40);
      }
    for (let i = 0; i < 8; i++) {
      const x = 20 + i * 30;
      line(rgba, W, x, 0, x + 40, H, 40, 100, 160, 25, 1);
    }
  }
  return encodePng(W, H, rgba);
}

function drawPreview(theme) {
  const W = 160;
  const H = 100;
  const rgba = Buffer.alloc(W * H * 4);
  const felt = { jade: [22, 68, 52], anime: [72, 42, 128] }[theme];
  const accent = {
    jade: [201, 169, 97],
    anime: [255, 141, 199],
  }[theme];
  const back = { jade: [92, 28, 26], anime: [140, 70, 190] }[theme];
  fill(rgba, W, H, felt[0], felt[1], felt[2]);
  if (theme === "anime") {
    for (let i = 0; i < 12; i++)
      star(rgba, W, 20 + i * 12, 20 + (i % 3) * 18, 3, 1, 255, 220, 240, 160);
  } else if (theme === "night") {
    for (let i = 0; i < 30; i++)
      px(rgba, W, (i * 37) % W, (i * 53) % H, 200, 230, 255, 200);
  } else {
    for (let i = 0; i < W; i += 16)
      line(rgba, W, i, 0, i + 40, H, 201, 169, 97, 30, 1);
  }
  fillRect(rgba, W, 16, 14, 52, 72, back[0], back[1], back[2]);
  frame(rgba, W, H, 0, accent[0], accent[1], accent[2], 0, 0);
  for (let t = 0; t < 2; t++) {
    fillRect(rgba, W, 16 + t, 14 + t, 52 - 2 * t, 1, accent[0], accent[1], accent[2], 230);
    fillRect(rgba, W, 16 + t, 14 + 71 - t, 52 - 2 * t, 1, accent[0], accent[1], accent[2], 230);
    fillRect(rgba, W, 16 + t, 14 + t, 1, 72 - 2 * t, accent[0], accent[1], accent[2], 230);
    fillRect(rgba, W, 16 + 51 - t, 14 + t, 1, 72 - 2 * t, accent[0], accent[1], accent[2], 230);
  }
  if (theme === "anime") {
    circle(rgba, W, 36, 44, 8, 255, 120, 170, 255);
    circle(rgba, W, 48, 44, 8, 255, 120, 170, 255);
    fillRect(rgba, W, 34, 50, 16, 12, 255, 120, 170, 255);
  } else if (theme === "night") {
    circle(rgba, W, 42, 50, 12, 200, 230, 255, 230);
    circle(rgba, W, 48, 46, 9, 18, 50, 90, 255);
  } else {
    fillRect(rgba, W, 30, 40, 24, 28, accent[0], accent[1], accent[2], 230);
    fillRect(rgba, W, 34, 44, 16, 20, back[0], back[1], back[2], 255);
  }
  fillRect(rgba, W, 80, 28, 60, 10, accent[0], accent[1], accent[2], 200);
  fillRect(rgba, W, 80, 48, 48, 8, 243, 234, 214, 170);
  fillRect(rgba, W, 80, 64, 36, 8, 243, 234, 214, 110);
  for (let t = 0; t < 2; t++) {
    fillRect(rgba, W, t, t, W - 2 * t, 1, accent[0], accent[1], accent[2], 200);
    fillRect(rgba, W, t, H - 1 - t, W - 2 * t, 1, accent[0], accent[1], accent[2], 200);
    fillRect(rgba, W, t, t, 1, H - 2 * t, accent[0], accent[1], accent[2], 200);
    fillRect(rgba, W, W - 1 - t, t, 1, H - 2 * t, accent[0], accent[1], accent[2], 200);
  }
  return encodePng(W, H, rgba);
}

mkdirSync(OUT_WEB, { recursive: true });
mkdirSync(OUT_COCOS, { recursive: true });
for (const id of ["jade", "anime"]) {
  for (const [kind, fn] of [
    ["back", drawCardBack],
    ["felt", drawFelt],
    ["preview", drawPreview],
  ]) {
    const name = `${id}-${kind}.png`;
    const buf = fn(id);
    writeFileSync(join(OUT_WEB, name), buf);
    copyFileSync(join(OUT_WEB, name), join(OUT_COCOS, name));
    console.log(name, buf.length);
  }
}
console.log("done");
