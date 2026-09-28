/**
 * 最先执行：创建主画布，并把未捕获错误画到屏幕上，
 * 这样即使后续模块初始化失败也不会只剩白屏。
 */
import { api } from "./platform";

export const sys = api.getSystemInfoSync();
export const canvas = api.createCanvas();
canvas.width = sys.windowWidth * sys.pixelRatio;
canvas.height = sys.windowHeight * sys.pixelRatio;
const ctx = canvas.getContext("2d");

const lines: string[] = [];
let failed = false;

export function bootFailed(): boolean {
  return failed;
}

function render(): void {
  ctx.setTransform(sys.pixelRatio, 0, 0, sys.pixelRatio, 0, 0);
  ctx.fillStyle = "#1f4d3a";
  ctx.fillRect(0, 0, sys.windowWidth, sys.windowHeight);
  ctx.fillStyle = "#f3e6c4";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  lines.forEach((l, i) => ctx.fillText(l, 60, 40 + i * 26));
}

export function log(msg: string): void {
  console.log(`[probe] ${msg}`);
  lines.push(msg);
  render();
}

api.onError?.((res) => {
  failed = true;
  log(`FAIL ${res.message}`);
});
log("启动中");
