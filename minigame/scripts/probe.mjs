/**
 * 在 Node 里模拟 wx 全局，跑打包后的 dist/wechat/game.js，验证适配层 + 联机链路。
 * 底层用 Node 自带的 WebSocket / fetch，不引入新依赖。
 * 运行：MG_ENTRY=probe node minigame/build.mjs && node minigame/scripts/probe.mjs（默认连线上服务；本地加 MG_WS=ws://127.0.0.1:2567）
 */
import { readFileSync } from "fs";
import { join } from "path";
import vm from "vm";

const GAME_JS = join(import.meta.dirname, "../dist/wechat/game.js");
const store = new Map();
const NativeWebSocket = globalThis.WebSocket;

function connectSocket({ url, protocols }) {
  const ws = new NativeWebSocket(url, protocols);
  ws.binaryType = "arraybuffer";
  return {
    send: ({ data }) => ws.send(data),
    close: ({ code, reason }) => ws.close(code, reason),
    onOpen: (cb) => ws.addEventListener("open", () => cb()),
    onMessage: (cb) => ws.addEventListener("message", (e) => cb({ data: e.data })),
    onClose: (cb) =>
      ws.addEventListener("close", (e) => cb({ code: e.code, reason: e.reason })),
    onError: (cb) => ws.addEventListener("error", () => cb({ errMsg: "socket error" })),
  };
}

function request({ url, method = "GET", header, data, dataType, success, fail }) {
  fetch(url, { method, headers: header, body: data })
    .then(async (res) => {
      const text = await res.text();
      let body = text;
      if (dataType !== "text") {
        try {
          body = JSON.parse(text);
        } catch {
          /* 保持字符串 */
        }
      }
      success({
        statusCode: res.status,
        data: body,
        header: Object.fromEntries(res.headers),
      });
    })
    .catch((e) => fail({ errMsg: `request:fail ${e.message}` }));
}

const ctx2d = new Proxy({}, { get: () => () => undefined, set: () => true });

globalThis.wx = {
  connectSocket,
  request,
  getStorageSync: (k) => store.get(k) ?? "",
  setStorageSync: (k, v) => store.set(k, v),
  removeStorageSync: (k) => store.delete(k),
  getSystemInfoSync: () => ({
    windowWidth: 812,
    windowHeight: 375,
    pixelRatio: 2,
    platform: "devtools",
  }),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
};
delete globalThis.XMLHttpRequest;

const origLog = console.log;
console.log = (...args) => {
  origLog(...args);
  const msg = args.join(" ");
  if (msg.startsWith("[probe] OK")) setTimeout(() => process.exit(0), 300);
  if (msg.startsWith("[probe] FAIL")) process.exit(1);
};
setTimeout(() => {
  origLog("❌ 超时未收到手牌");
  process.exit(1);
}, 20_000);

vm.runInThisContext(readFileSync(GAME_JS, "utf8"), { filename: GAME_JS });
