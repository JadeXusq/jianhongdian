/**
 * 离线人机端到端：虚拟时钟跑打包后的 game.js，脚本玩家全程用触摸操作，校验每轮结算。
 * 运行：node minigame/build.mjs && npx tsx minigame/scripts/playtest.ts
 */
import shared from "@jhd/shared";
import { installWx, playMyTurn } from "./mockwx";

const { chooseHandPlay } = shared;
const h = installWx(true);

const plan = [
  { players: 2, rounds: 3 },
  { players: 4, rounds: 1 },
];
let planIdx = 0;
let roundsDone = 0;
let lastAct = 0;
let lastRoundSeen: unknown = null;
let failed = "";
let guideSeen = false;
const checked: string[] = [];

h.onFrame(() => {
  const j = h.hook();
  const cur = plan[planIdx];
  if (!j || failed || !cur || h.now() - lastAct < 250) return;

  if (h.tapButton("确定结算")) {
    lastAct = h.now();
    return;
  }
  if (j.screen === "guide") {
    lastAct = h.now();
    guideSeen = h.tapButton("知道了，开打");
    return;
  }
  if (j.overlay.hits.some((b: any) => b.label === "同意并继续")) {
    // 首次进入：全屏隐私页，须在画布上点「同意并继续」，平台才会记录同意
    lastAct = h.now();
    if (privacyStep > 0) failed = "同意后隐私页未关闭";
    else if (h.privacyExposures() < 1) failed = "隐私页展示时未上报曝光";
    else if (h.nickButton()?.visible) failed = "隐私页上不应盖原生授权按钮";
    else h.tapButton("同意并继续");
    privacyStep = 1;
    return;
  }
  if (j.screen === "nick") {
    // 同意后无昵称：昵称引导里点「用微信昵称」（原生按钮）取昵称
    lastAct = h.now();
    const hit = [...j.overlay.hits].reverse().find((b: any) => b.label === "用微信昵称");
    const btn = h.nickButton();
    if (!hit || !btn?.visible || btn.style.left !== Math.round(hit.x) || btn.style.top !== Math.round(hit.y))
      failed = "原生授权按钮未盖在「用微信昵称」上";
    else btn.tap("微信小明");
    return;
  }
  if (j.screen === "lobby") {
    lastAct = h.now();
    if (!privacyStep) {
      failed = "首次进入未弹出隐私页";
      return;
    }
    if (!h.privacyAgreed()) {
      failed = "平台未记录同意，下次启动会再弹隐私页";
      return;
    }
    if (ageStep === 0) {
      if (!h.tapButton("适龄提示")) failed = "大厅缺少适龄标记";
      ageStep = 1;
      return;
    }
    if (ageStep === 1) {
      if (!h.tapButton("知道了")) failed = "适龄说明面板未打开";
      ageStep = 2;
      return;
    }
    h.tapButton(`${cur.players} 人`);
    if (!h.tapButton("人机练习（可离线）")) h.tapButton("继续人机练习");
    return;
  }
  if (j.screen === "result") {
    const r = j.lastRound;
    if (!r) return;
    if (r !== lastRoundSeen) {
      lastRoundSeen = r;
      const pts = r.points.reduce((a: number, b: number) => a + b, 0);
      const net = r.net.reduce((a: number, b: number) => a + b, 0);
      if (!r.allDone && pts !== 240) failed = `第 ${r.round} 轮总分 ${pts}≠240`;
      if (net !== 0) failed = `第 ${r.round} 轮净分和 ${net}≠0`;
      checked.push(`${cur.players}人 ${r.allDone ? "终局" : `第${r.round}轮`} 得分${JSON.stringify(r.points)} 净${JSON.stringify(r.net)}`);
      if (!r.allDone) roundsDone++;
    }
    lastAct = h.now();
    if (r.allDone) {
      h.tapButton("返回大厅");
      planIdx++;
      roundsDone = 0;
      return;
    }
    h.tapButton(roundsDone >= cur.rounds ? "结算本场" : "继续下一轮");
    return;
  }
  const off = j.offline;
  if (!nickChecked && off) {
    const names = [...off.state.players.values()].map((p: any) => p.name);
    if (!names.includes("微信小明")) failed = `授权昵称未用于对局：${names.join("/")}`;
    else if (h.nickButton()?.visible) failed = "离开大厅后原生授权按钮未隐藏";
    nickChecked = true;
  }
  if (maskStep < 3 && off?.state.phase === "PLAYING" && off.state.currentSeat !== off.mySeat) {
    lastAct = h.now();
    const o = j.overlay;
    if (maskStep === 0 && j.screen === "none" && h.tapButton("菜单")) maskStep = 1;
    else if (maskStep === 1 && j.screen === "menu") {
      const panel = o.hits.find((b: any) => b.label === "" && b.w < o.w);
      h.tap(panel.x + 6, panel.y + 6);
      maskStep = 2;
    } else if (maskStep === 2) {
      if (j.screen !== "menu") failed = "点面板空白处不应关闭菜单";
      h.tap(2, o.h - 2);
      maskStep = 3;
    }
    return;
  }
  if (maskStep === 3) {
    if (j.screen !== "none") failed = "点遮罩未关闭菜单";
    maskStep = 4;
  }
  if (off && playMyTurn(h, chooseHandPlay, off.state, off.hand, off.mySeat)) lastAct = h.now();
});

let maskStep = 0;
let privacyStep = 0;
let ageStep = 0;
let nickChecked = false;

const t0 = h.now();
await h.run(() => !!failed || h.errors.length > 0 || planIdx >= plan.length, 60 * 60_000);

checked.forEach((c) => console.log("  ", c));
const err =
  failed ||
  h.errors[0] ||
  (guideSeen ? "" : "首局未弹出新手引导") ||
  (maskStep === 4 ? "" : "未完成遮罩关闭检查") ||
  (nickChecked ? "" : "未完成昵称授权检查");
if (err || planIdx < plan.length) {
  console.log(`❌ ${err || `未跑完（停在第 ${planIdx + 1} 场，界面 ${h.hook()?.screen}）`}`);
  process.exit(1);
}
console.log(`✅ 离线人机端到端通过（虚拟 ${Math.round((h.now() - t0) / 1000)}s）`);
process.exit(0);
