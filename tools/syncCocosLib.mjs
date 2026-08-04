/**
 * 把规则引擎与 Colyseus SDK 同步进 Cocos 工程。
 *
 * - shared/src/*.ts 直接复制为 Cocos 脚本：Cocos 不解析 node_modules，
 *   复制源码可保留完整 TS 类型；shared/ 仍是唯一源头，这里产出的是构建物。
 * - Colyseus 用 esbuild 从其浏览器入口（package.json exports.browser → lib/index.js）
 *   打成 IIFE 插件脚本。不能直接用 dist/ 里的 UMD：那两个文件打包了 Node 版
 *   ws 代码，模块顶层就会执行 Buffer[Symbol.species]，浏览器里报 Buffer is not defined。
 *
 * 运行：node tools/syncCocosLib.mjs
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { build } from "esbuild";

const ROOT = join(import.meta.dirname, "..");
const RULES_DST = join(ROOT, "cocos/assets/scripts/rules");
const LIB_DST = join(ROOT, "cocos/assets/scripts/lib");

const HEADER = `// ⚠️ 自动生成，请勿直接修改：源文件在 shared/src/，改完执行 node tools/syncCocosLib.mjs\n`;

mkdirSync(RULES_DST, { recursive: true });
mkdirSync(LIB_DST, { recursive: true });

// ---------- 规则引擎 ----------
const srcDir = join(ROOT, "shared/src");
for (const f of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
  const code = readFileSync(join(srcDir, f), "utf8");
  writeFileSync(join(RULES_DST, f), HEADER + code);
  console.log("规则", f);
}

// ---------- Colyseus 插件脚本 ----------
await build({
  entryPoints: [join(ROOT, "node_modules/colyseus.js/lib/index.js")],
  bundle: true,
  format: "iife",
  globalName: "Colyseus",
  // 插件脚本被包在模块作用域，iife 的 var 不会泄露到全局，靠 footer 显式挂载。
  // 不能用 globalName: "globalThis.Colyseus"：esbuild 会生成
  // var globalThis = globalThis || {}，反而把真全局屏蔽掉。
  footer: { js: "\nglobalThis.Colyseus = Colyseus;" },
  platform: "browser",
  target: ["es2017"],
  outfile: join(LIB_DST, "colyseus.js"),
  logLevel: "warning",
});
writeFileSync(
  join(LIB_DST, "colyseus.js.meta"),
  JSON.stringify(
    {
      ver: "4.0.24",
      importer: "javascript",
      imported: true,
      uuid: "a1b2c3d4-1111-4222-8333-4444555566a1",
      files: [],
      subMetas: {},
      userData: {
        isPlugin: true,
        loadPluginInWeb: true,
        loadPluginInNative: true,
        loadPluginInEditor: false,
      },
    },
    null,
    2
  )
);
console.log("Colyseus SDK（浏览器入口 → IIFE 插件脚本）已同步");
