/**
 * 入口：界面切换与出牌交互
 * 交互约定：点手牌 → 唯一目标直接吃；多目标高亮待选；无目标需再点一次确认弃牌。
 */
import { cardScore, findTargets } from "@jhd/shared";
import { ROUND_RESULT_AUTO_MS } from "@jhd/shared";
import { sfx } from "./audio";
import { loadCardAtlas } from "./cardRender";
import { onOrientationChange, shouldRotate } from "./layout";
import { Net, RoundOver, deviceId, savedAccountId } from "./net";
import { TableView } from "./table";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const net = new Net();
let maxPlayers = 4;
let selected = -1;
/** 无目标的牌需二次点击确认弃牌，避免误操作 */
let discardArmed = -1;
let lastRound: RoundOver | null = null;
/** 用于判断“刚轮到我”的边沿，避免每帧重复提醒 */
let wasMyTurn = false;

void loadCardAtlas();

const view = new TableView($<HTMLCanvasElement>("table"), {
  onPickHand: (id) => pickHand(id),
  onPickTable: (id) => pickTable(id),
});

// ---------- 界面切换 ----------

function show(
  id: "lobby" | "room" | "result" | "rules" | "rank" | "account" | "none"
): void {
  ["lobby", "room", "result", "rules", "rank", "account"].forEach((s) =>
    $(s).classList.toggle("hidden", s !== id)
  );
}

const shown = (id: string) => !$(id).classList.contains("hidden");

// 竖屏手机下把 UI 层一起旋转，与牌桌方向保持一致
function applyOrientation(): void {
  $("ui").classList.toggle("rot", shouldRotate());
}
applyOrientation();
onOrientationChange(applyOrientation);

// 首次手势时解锁音频并起背景音乐（浏览器策略要求）
window.addEventListener(
  "pointerdown",
  () => {
    sfx.unlock();
    sfx.startBgm();
  },
  { once: true }
);

const muteBtn = $<HTMLButtonElement>("btn-mute");
muteBtn.classList.toggle("off", sfx.muted);
muteBtn.onclick = () => {
  sfx.unlock();
  muteBtn.classList.toggle("off", sfx.toggleMute());
};

let toastTimer = 0;
function toast(msg: string): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 2200);
}

function hint(msg: string | null): void {
  const el = $("turn-hint");
  el.classList.toggle("hidden", !msg);
  if (msg) el.textContent = msg;
}

// ---------- 大厅 ----------

const nameInput = $<HTMLInputElement>("name");
nameInput.value = localStorage.getItem("jhd.name") ?? "";

function playerName(): string {
  const v = nameInput.value.trim() || "无名客";
  localStorage.setItem("jhd.name", v);
  return v;
}

$("counts").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  maxPlayers = Number(btn.dataset.n);
  Array.from($("counts").children).forEach((b) =>
    b.classList.toggle("on", b === btn)
  );
});

async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    toast((e as Error).message || "连接失败，请确认服务器已启动");
  }
}

$("btn-match").onclick = () =>
  guard(async () => {
    await net.quickMatch(playerName(), maxPlayers);
    net.ready(true); // 快速匹配默认自动准备
    show("room");
  });

$("btn-create").onclick = () =>
  guard(async () => {
    await net.create(playerName(), maxPlayers);
    show("room");
  });

$("btn-join").onclick = () =>
  guard(async () => {
    const code = prompt("请输入 6 位房号")?.trim();
    if (!code) return;
    await net.joinByCode(playerName(), code);
    show("room");
  });

$("btn-spectate").onclick = () =>
  guard(async () => {
    const code = prompt("请输入要观战的 6 位房号")?.trim();
    if (!code) return;
    await net.spectateByCode(playerName(), code);
    toast("已进入观战");
    show("none");
  });

$("btn-rules").onclick = () => show("rules");
$("btn-rules-close").onclick = () => show(net.room ? "room" : "lobby");

$("btn-rank").onclick = () =>
  guard(async () => {
    const rows = await net.leaderboard();
    const me = deviceId();
    const acc = savedAccountId();
    $("rank-list").innerHTML = rows.length
      ? rows
          .map(
            (r, i) => `
        <div class="res${
          r.deviceId === me || r.deviceId === acc || r.accountId === acc
            ? " me"
            : ""
        }">
          <span class="rank">${i + 1}</span>
          <span class="who">${r.name}${r.accountId ? " ·账号" : ""}</span>
          <span class="calc">${r.games} 局 · 胜 ${r.wins}</span>
          <span class="net ${
            r.totalNet > 0 ? "win" : r.totalNet < 0 ? "lose" : ""
          }">${r.totalNet > 0 ? "+" : ""}${r.totalNet}</span>
        </div>`
          )
          .join("")
      : '<div class="res"><span class="who">还没有战绩，快去开一局</span></div>';
    show("rank");
  });
$("btn-rank-close").onclick = () => show("lobby");

$("btn-account").onclick = () => {
  const acc = savedAccountId();
  $("account-status").textContent = acc
    ? `已绑定账号 ${acc}`
    : "未绑定（游客战绩仅存本机）";
  $("account-hint").textContent = "";
  const idInput = $<HTMLInputElement>("acc-id");
  const tokInput = $<HTMLInputElement>("acc-token");
  idInput.value = acc ?? "";
  tokInput.value = "";
  show("account");
};
$("btn-account-close").onclick = () => show("lobby");

$("btn-acc-create").onclick = () =>
  guard(async () => {
    const data = await net.createAccount(playerName());
    $("account-status").textContent = `已绑定账号 ${data.accountId}`;
    $("account-hint").textContent =
      `请妥善保存凭证（只显示一次）：${data.token}`;
    $<HTMLInputElement>("acc-id").value = data.accountId;
    $<HTMLInputElement>("acc-token").value = data.token;
    toast("账号已创建并绑定本机");
  });

$("btn-acc-bind").onclick = () =>
  guard(async () => {
    const accountId = $<HTMLInputElement>("acc-id").value.trim();
    const token = $<HTMLInputElement>("acc-token").value.trim();
    if (!accountId || !token) throw new Error("请填写账号 ID 与凭证");
    const profile = await net.bindAccount(accountId, token);
    $("account-status").textContent = `已绑定账号 ${accountId}`;
    $("account-hint").textContent = `战绩已合并：${profile.games} 局 · 净分 ${profile.totalNet}`;
    toast("绑定成功，战绩已合并");
  });

// ---------- 房间 ----------

let aiDifficulty: "easy" | "normal" | "hard" = "normal";

$("ai-diff").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const d = (btn as HTMLButtonElement).dataset.d as
    | "easy"
    | "normal"
    | "hard";
  if (!d) return;
  aiDifficulty = d;
  Array.from($("ai-diff").children).forEach((b) =>
    b.classList.toggle("on", b === btn)
  );
});

$("btn-ai").onclick = () => net.addAi(aiDifficulty);
$("btn-ready").onclick = () => {
  const me = net.state?.players.get(net.room!.sessionId);
  net.ready(!me?.ready);
};
$("btn-quit").onclick = () =>
  guard(async () => {
    await net.leave();
    show("lobby");
  });

function renderRoom(state: any): void {
  $("room-code").textContent = state.code;
  const seats = $("seats");
  seats.innerHTML = "";
  const players = [...state.players.values()] as any[];
  for (let i = 0; i < state.maxPlayers; i++) {
    const p = players.find((x) => x.seat === i);
    const div = document.createElement("div");
    div.className = "seat" + (p ? "" : " empty");
    div.innerHTML = p
      ? `<div class="avatar">${p.name.slice(0, 1)}</div>
         <div class="who">${p.name}${p.isAi ? " · 电脑" : ""}${
          p.sessionId === net.room?.sessionId ? "（我）" : ""
        }</div>
         <div class="tag">${p.ready ? "已准备" : "等待中"}</div>`
      : `<div class="avatar">＋</div><div class="who">等待玩家…</div>`;
    seats.appendChild(div);
  }
  const me = players.find((x) => x.sessionId === net.room?.sessionId);
  $<HTMLButtonElement>("btn-ready").textContent = me?.ready
    ? "取消准备"
    : "准备";
  const isHost = state.hostSessionId === net.room?.sessionId;
  $<HTMLButtonElement>("btn-ai").disabled =
    players.length >= state.maxPlayers || !isHost;
}

// ---------- 结算 ----------

$("btn-again").onclick = () => {
  net.nextRound();
  show("room");
};
$("btn-exit").onclick = () =>
  guard(async () => {
    await net.leave();
    show("lobby");
  });

function renderResult(r: RoundOver): void {
  const players = [...net.state.players.values()] as any[];
  const rows = players
    .map((p) => ({ p, points: r.points[p.seat], net: r.net[p.seat] }))
    .sort((a, b) => b.net - a.net);

  // 标题：显示轮次进度
  const title = $("result").querySelector(".title") as HTMLElement;
  title.textContent = r.allDone
    ? `最终结算（${r.totalRounds} 轮总分）`
    : `第 ${r.round} / ${r.totalRounds} 轮`;

  $("result-list").innerHTML = rows
    .map(
      (row, i) => `
      <div class="res${row.p.seat === net.mySeat ? " me" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">${row.p.name}${row.p.isAi ? " · 电脑" : ""}</span>
        <span class="calc">${row.points} − ${r.base}${
        r.allDone ? " | 总 " + row.p.totalNet : ""
      }</span>
        <span class="net ${row.net > 0 ? "win" : row.net < 0 ? "lose" : ""}">${
        row.net > 0 ? "+" : ""
      }${row.net}</span>
      </div>`
    )
    .join("");

  // 未打完时按钮文案变为“继续下一轮”，并 3 秒后自动关闭弹窗回到牌桌
  const btnAgain = $<HTMLButtonElement>("btn-again");
  const btnExit = $<HTMLButtonElement>("btn-exit");
  if (r.allDone) {
    btnAgain.textContent = "再来一局";
    btnExit.style.display = "";
  } else {
    btnAgain.textContent = `继续下一轮 (${r.round}/${r.totalRounds})`;
    btnExit.style.display = "none";
    // 3 秒后自动关闭结算弹窗（服务器会自动开下一轮）
    setTimeout(() => {
      if (shown("result")) show("none");
    }, ROUND_RESULT_AUTO_MS);
  }
  show("result");
}

// ---------- 出牌交互 ----------

function myTurn(): boolean {
  if (net.spectating) return false;
  return net.state?.phase === "PLAYING" && net.state.currentSeat === net.mySeat;
}

function pickHand(id: number): void {
  if (!myTurn() || net.state.turnPhase !== "PLAY_HAND" || view.animating)
    return;
  const targets = findTargets(id, [...net.state.table]);

  if (targets.length === 1) return send(id, targets[0]);
  if (targets.length === 0) {
    // 二次点击同一张牌才真正弃牌
    if (discardArmed === id) return send(id);
    discardArmed = id;
    selected = id;
    syncSelection();
    hint("该牌无可吃目标，再点一次确认打出");
    return;
  }
  selected = id;
  discardArmed = -1;
  syncSelection();
  hint("选择要吃的桌面牌");
}

function pickTable(id: number): void {
  if (!myTurn() || view.animating) return;
  if (net.state.turnPhase === "CHOOSE_STOCK_TARGET") {
    if (view.targets.includes(id)) net.chooseTarget(id);
    return;
  }
  if (selected < 0 || !view.targets.includes(id)) return;
  send(selected, id);
}

function send(cardId: number, targetId?: number): void {
  net.play(cardId, targetId);
  net.hand = net.hand.filter((c) => c !== cardId); // 本地先移除，避免重复点击
  selected = -1;
  discardArmed = -1;
  syncSelection();
  hint(null);
}

/** 同步选中态与可吃目标高亮 */
function syncSelection(): void {
  view.selected = selected;
  const state = net.state;
  if (!state) {
    view.targets = [];
    return;
  }
  if (
    state.turnPhase === "CHOOSE_STOCK_TARGET" &&
    state.currentSeat === net.mySeat
  )
    view.targets = findTargets(state.pendingStockCard, [...state.table]);
  else if (selected >= 0)
    view.targets = findTargets(selected, [...state.table]);
  else view.targets = [];
}

// ---------- 网络回调 ----------

net.onState = (state) => {
  view.state = state;
  view.hand = net.hand;
  view.mySeat = net.mySeat;

  if (state.phase === "WAITING") {
    renderRoom(state);
    $("emotes").classList.add("hidden");
    if (!shown("result") && !shown("rules") && !shown("rank")) show("room");
  } else if (state.phase === "PLAYING") {
    if (shown("rules") || shown("rank")) return;
    show("none");
    $("emotes").classList.remove("hidden");
    const mine = myTurn();
    if (mine && !wasMyTurn) sfx.turn();
    wasMyTurn = mine;
    if (net.spectating) hint("观战中");
    else if (mine)
      hint(
        state.turnPhase === "CHOOSE_STOCK_TARGET"
          ? "翻牌可吃，请选择目标"
          : "轮到你出牌"
      );
    else hint(null);
  }
  syncSelection();
};

net.onRoundStart = () => {
  selected = -1;
  discardArmed = -1;
  lastRound = null;
  show("none");
};

net.onEvents = (events) => {
  view.pushEvents(events);
  view.hand = net.hand;
  for (const ev of events) {
    if (ev.target === undefined) sfx.playCard();
    else sfx.capture(cardScore(ev.card) + cardScore(ev.target));
  }
};

net.onRoundOver = (r) => {
  lastRound = r;
  // 等最后一次吃牌动画播完再弹结算
  const wait = () => {
    if (view.animating) return void setTimeout(wait, 120);
    sfx.roundOver();
    renderResult(r);
  };
  setTimeout(wait, 200);
};

$("emotes").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn || !net.room) return;
  const id = (btn as HTMLButtonElement).dataset.e;
  if (id) net.emote(id);
});

let emoteTimer = 0;
net.onEmote = (e) => {
  const el = $("emote-bubble");
  el.textContent = `${e.name}：${e.id}`;
  el.classList.remove("hidden");
  clearTimeout(emoteTimer);
  emoteTimer = window.setTimeout(() => el.classList.add("hidden"), 2200);
};

net.onError = (msg) => {
  toast(msg);
  selected = -1;
  discardArmed = -1;
  syncSelection();
};

net.onLeave = () => {
  if (lastRound) return; // 结算界面里主动退出，不再提示
  toast("已断开连接");
  show("lobby");
};

// 刷新页面后尝试回到原对局
net.tryReconnect().then((ok) => {
  if (ok) toast("已重连回到对局");
});

// 开发期调试钩子，供自动化视觉校验脚本精确定位牌位
if (import.meta.env.DEV) (window as any).__jhd = { net, view };

// ---------- 主循环 ----------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  view.hand = net.hand;
  view.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
