/**
 * 打包小游戏：src/<entry>.ts → dist/{wechat,douyin}/game.js，并复制平台工程配置与 assets。
 * 运行：node minigame/build.mjs
 *   MG_ENTRY=probe  改为打包联机探针（默认 game）
 *   MG_WS=ws://...  服务器地址，默认与 Web 线上一致；本地调试用 MG_WS=ws://127.0.0.1:2567
 *   MG_RELEASE=1    正式包：去掉调试钩子 globalThis.__jhd 并压缩
 *   MG_AUTOSTART=2  开发用：启动即进入 N 人人机练习（开发者工具无法自动点击时截图用）
 *   MG_DEMO=menu    开发用：启动即打开指定界面（同上，截图检查排版）
 */
import { cpSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { build } from "esbuild";

const ROOT = import.meta.dirname;
const ENTRY = process.env.MG_ENTRY?.trim() || "game";
const WS_URL = process.env.MG_WS?.trim() || "wss://jhd-server.onrender.com";

for (const target of ["wechat", "douyin"]) {
  const out = join(ROOT, "dist", target);
  rmSync(join(out, "assets"), { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(ROOT, target), out, { recursive: true });
  cpSync(join(ROOT, "assets"), join(out, "assets"), {
    recursive: true,
    filter: (src) => !src.endsWith(".json"),
  });
  await build({
    entryPoints: [join(ROOT, "src", `${ENTRY}.ts`)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2017"],
    conditions: ["browser"],
    define: {
      __WS_URL__: JSON.stringify(WS_URL),
      __DEV__: JSON.stringify(process.env.MG_RELEASE !== "1"),
      __AUTOSTART__: String(Number(process.env.MG_AUTOSTART) || 0),
      __DEMO__: JSON.stringify(process.env.MG_DEMO?.trim() || ""),
    },
    outfile: join(out, "game.js"),
    minify: process.env.MG_RELEASE === "1",
    logLevel: "warning",
  });
  console.log(`${target}（${ENTRY}）→ ${out}`);
}
