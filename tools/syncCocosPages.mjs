#!/usr/bin/env node
/**
 * 将 cocos/build/web-mobile 同步到 publish/cocos，供 Pages CI 拷贝。
 * 用法：先用 Creator 构建 web-mobile，再 node tools/syncCocosPages.mjs
 */
import {
  cpSync,
  existsSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "cocos/build/web-mobile");
const dest = join(root, "publish/cocos");

if (!existsSync(join(src, "index.html"))) {
  console.error("缺少 cocos/build/web-mobile，请先 Creator 构建 platform=web-mobile");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

for (const f of ["card-atlas.png", "card-atlas.json"]) {
  const from = join(root, "client/public", f);
  if (existsSync(from)) cpSync(from, join(dest, f));
  else console.warn("缺少", from);
}

const cssPath = join(dest, "style.css");
if (existsSync(cssPath)) {
  let css = readFileSync(cssPath, "utf8");
  css = css.replace(/background-color:\s*#333;/, "background-color: #0a1a14;");
  writeFileSync(cssPath, css);
}

const htmlPath = join(dest, "index.html");
let html = readFileSync(htmlPath, "utf8");
if (!html.includes("__JHD_WS__")) {
  html = html.replace(
    "<head>",
    `<head>\n  <script>window.__JHD_WS__=window.__JHD_WS__||"";</script>`
  );
}
writeFileSync(htmlPath, html);

console.log(`synced → publish/cocos (${dest})`);
