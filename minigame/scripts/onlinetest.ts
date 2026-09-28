/**
 * 联机端到端（真实时间，需先启动 server）：
 *  A. 小游戏当房主：创建房间 → 添加机器人 → 准备 → 打一轮 → 结束本场 → 返回大厅
 *  B. Node 客户端开房，小游戏用房号键盘加入 → 准备 → 对打一轮 → 房主结束本场 → 返回大厅
 * 运行：MG_WS=ws://127.0.0.1:2567 node minigame/build.mjs && npx tsx minigame/scripts/onlinetest.ts
 */
import { Client, type Room } from "colyseus.js";
import shared from "@jhd/shared";
import { installWx, playMyTurn } from "./mockwx";

const { chooseHandPlay, bestTarget, findTargets } = shared;
const ENDPOINT = "ws://127.0.0.1:2567";
const h = installWx(false);

let failed = "";
let lastAct = 0;
const seen: string[] = [];
let stage = "A";
let lastRoundSeen: unknown = null;
let hostBot: Room<any> | null = null;
let codeTyped = false;

function checkRound(r: any): void {
  if (r === lastRoundSeen) return;
  lastRoundSeen = r;
  const pts = r.points.reduce((a: number, b: number) => a + b, 0);
  const net = r.net.reduce((a: number, b: number) => a + b, 0);
  if (!r.allDone && pts !== 240) failed = `总分 ${pts}≠240`;
  if (net !== 0) failed = `净分和 ${net}≠0`;
  seen.push(`${stage} ${r.allDone ? "终局" : `第${r.round}轮`} 得分${JSON.stringify(r.points)} 净${JSON.stringify(r.net)}`);
}

h.onFrame(() => {
  const j = h.hook();
  if (!j || failed || h.now() - lastAct < 300) return;
  const act = () => (lastAct = h.now());
  const net = j.net;
  if (h.tapButton("确定结算")) {
    act();
    return;
  }
  // 首次进入的隐私页：这里走「不同意并退出」分支
  if (!privacyRefused && h.tapButton("不同意并退出")) {
    act();
    privacyRefused = true;
    return;
  }
  if (j.screen === "nick") {
    act();
    h.tapButton("稍后再说");
    return;
  }
  if (j.screen === "guide") {
    act();
    h.tapButton("知道了，开打");
    return;
  }

  if (stage === "A") {
    if (j.screen === "lobby" && !seen.length) {
      act();
      h.tapButton("2 人");
      h.tapButton("创建房间");
    } else if (j.screen === "room") {
      act();
      const me = net.state.players.get(net.room.sessionId);
      const code = String(net.state.code);
      if (!inviteChecked) {
        h.tapButton("邀请好友");
        const s = h.shares.at(-1);
        const m = h.menuShare();
        if (s?.query !== `room=${code}` || !s.imageUrl || !s.title.includes(code))
          failed = `邀请分享不对：${JSON.stringify(s)}`;
        else if (m?.query !== `room=${code}`) failed = `菜单转发未带房号：${JSON.stringify(m)}`;
        inviteChecked = true;
      } else if (net.state.players.size < 2) h.tapButton("＋ 添加机器人");
      else if (!me.ready) h.tapButton("准备");
    } else if (j.screen === "result" && j.lastRound) {
      act();
      checkRound(j.lastRound);
      if (j.lastRound.allDone && !resultShared) {
        h.tapButton("分享战绩");
        const s = h.shares.at(-1);
        const m = h.menuShare();
        if (!s?.title.startsWith("捡红点战绩") || !s.imageUrl || s.query)
          failed = `战绩分享不对：${JSON.stringify(s)}`;
        else if (!m?.title.startsWith("捡红点战绩")) failed = `终局菜单转发不是战绩：${JSON.stringify(m)}`;
        else seen.push(`   战绩分享：${s.title}`);
        resultShared = true;
        return;
      }
      h.tapButton(j.lastRound.allDone ? "返回大厅" : "结算本场");
    } else if (j.screen === "lobby" && seen.length) {
      stage = "B-wait";
    } else if (playMyTurn(h, chooseHandPlay, net.state, net.hand, net.mySeat)) act();
    return;
  }

  if (stage === "B") {
    if (droppedRoom && net.room && net.room !== droppedRoom) reconnected = true;
    const code: string = hostBot?.state?.code ?? "";
    if (j.screen === "lobby" && code) {
      act();
      h.tapButton("输房号加入");
    } else if (j.screen === "code") {
      act();
      if (!codeTyped) {
        for (const d of code) h.tapButton(d);
        codeTyped = true;
      } else h.tapButton("确认加入");
    } else if (j.screen === "room") {
      act();
      const me = net.state.players.get(net.room.sessionId);
      if (me && !me.ready) h.tapButton("准备");
    } else if (j.screen === "result" && j.lastRound) {
      act();
      checkRound(j.lastRound);
      if (j.lastRound.allDone) {
        h.tapButton("返回大厅");
        stage = "done";
      } else if (!h.tapButton("继续下一轮")) failed = "非房主结算页缺少「继续下一轮」";
      else if (h.hook().overlay.hits.some((b: any) => b.label === "结算本场"))
        failed = "非房主不应看到「结算本场」";
    } else if (j.screen === "emote") {
      act();
      h.tapButton("💪加油");
    } else if (j.screen === "none" && net.state?.phase === "PLAYING") {
      if (!emoteSent) {
        act();
        emoteSent = h.tapButton("💬");
      } else if (!droppedRoom && net.hand.length === 8 && net.room) {
        act();
        droppedRoom = net.room;
        net.room.connection.transport.ws.close(3001);
      } else if (playMyTurn(h, chooseHandPlay, net.state, net.hand, net.mySeat)) act();
    }
  }
});

let privacyRefused = false;
let inviteChecked = false;
let resultShared = false;
let emoteSent = false;
let emoteSeen = false;
let droppedRoom: unknown = null;
let reconnected = false;

/** Node 端房主：按 AI 策略自动出牌，首轮结束后结束本场 */
async function startHostBot(): Promise<void> {
  const room = await new Client(ENDPOINT).create<any>("game", { name: "甲", maxPlayers: 2 });
  hostBot = room;
  let hand: number[] = [];
  room.onMessage("hand", (m: number[]) => (hand = m));
  room.onMessage("roundOver", (r: any) => {
    if (!r.allDone) setTimeout(() => room.send("endMatch"), 1500);
  });
  for (const t of ["events", "roundStart", "joined", "matchHistory", "error", "chat"])
    room.onMessage(t, () => undefined);
  room.onMessage("emote", (e: { id: string }) => (emoteSeen = e.id === "加油"));
  room.onStateChange((s: any) => {
    const me = s.players.get(room.sessionId);
    if (s.phase === "WAITING" && s.players.size === 2 && me && !me.ready) room.send("ready", true);
    if (s.phase !== "PLAYING" || s.currentSeat !== me?.seat) return;
    const table: number[] = [...s.table];
    if (s.turnPhase === "CHOOSE_STOCK_TARGET") {
      const targets = findTargets(s.pendingStockCard, table);
      if (targets.length) room.send("chooseTarget", { targetId: bestTarget(targets) });
      return;
    }
    if (!hand.length) return;
    const move = chooseHandPlay(hand, table);
    hand = hand.filter((c) => c !== move.cardId);
    room.send("play", move);
  });
}

const progress = setInterval(() => {
  const j = h.hook();
  const s = j?.net?.state;
  console.log(
    `  … ${stage} 界面=${j?.screen} 阶段=${s?.phase ?? "-"} 轮到=${s?.currentSeat ?? "-"} 我=${j?.net?.mySeat} 手牌=${j?.net?.hand?.length ?? 0} 锁=${j?.view?.turnBlocked}`
  );
}, 5000);

const doneA = await h.run(() => !!failed || h.errors.length > 0 || stage !== "A", 240_000);
if (doneA && !failed && !h.errors.length) {
  await startHostBot();
  stage = "B";
  await h.run(() => !!failed || h.errors.length > 0 || stage === "done", 240_000);
  await hostBot?.leave();
}

clearInterval(progress);
seen.forEach((s) => console.log("  ", s));
if (!failed && stage === "done") {
  if (!emoteSeen) failed = "房主未收到小游戏发出的表情";
  else if (!droppedRoom) failed = "未触发断线";
  else if (!reconnected) failed = "断线后未自动重连";
  else if (!inviteChecked || !resultShared) failed = "未完成分享检查";
  else if (!privacyRefused || !h.exited()) failed = "隐私页「不同意并退出」未退出小游戏";
  else console.log("   表情送达 ✓  断线自动重连后打完本轮 ✓");
}
const err = failed || h.errors[0];
if (err || stage !== "done") {
  console.log(`❌ ${err || `未跑完（阶段 ${stage}，界面 ${h.hook()?.screen}）`}`);
  process.exit(1);
}
console.log("✅ 联机端到端通过");
process.exit(0);
