/**
 * 入口：界面切换与出牌交互
 * 交互约定：点手牌 → 唯一目标直接吃；多目标高亮待选；无目标需再点一次确认弃牌。
 */
import { cardScore, findTargets } from "@jhd/shared";
import { ROUND_RESULT_AUTO_MS } from "@jhd/shared";
import { sfx } from "./audio";
import { loadCardAtlas } from "./cardRender";
import { onOrientationChange, shouldRotate } from "./layout";
import { LocalPlay } from "./localPlay";
import { Net, RoundOver, deviceId, savedAccountId } from "./net";
import { TableView } from "./table";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const net = new Net();
net.onProgress = (msg) => toast(msg, 5000);
/** 离线人机会话；有值时走浏览器内规则，不连服务器 */
let offline: LocalPlay | null = null;
let maxPlayers = 4;
let aiDifficulty: "easy" | "normal" | "hard" = "normal";
let selected = -1;
/** 无目标的牌需二次点击确认弃牌，避免误操作 */
let discardArmed = -1;
let lastRound: RoundOver | null = null;
/** 用于判断“刚轮到我”的边沿，避免每帧重复提醒 */
let wasMyTurn = false;

const assetBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
void loadCardAtlas(assetBase);

const view = new TableView($<HTMLCanvasElement>("table"), {
  onPickHand: (id) => pickHand(id),
  onPickTable: (id) => pickTable(id),
  onToggleCaptured: () => {
    view.showCaptured = !view.showCaptured;
  },
});

// ---------- 界面切换 ----------

function show(
  id:
    | "lobby"
    | "room"
    | "result"
    | "rules"
    | "rank"
    | "account"
    | "guide"
    | "none"
): void {
  ["lobby", "room", "result", "rules", "rank", "account", "guide"].forEach(
    (s) => $(s).classList.toggle("hidden", s !== id)
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
function toast(msg: string, ms = 2200): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), ms);
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
    const msg = (e as Error).message || "连接失败";
    toast(
      /fetch|network|failed|ECONN|timeout|abort/i.test(msg)
        ? "连接失败，服务器可能在休眠，请稍后重试或先用人机练习"
        : msg
    );
  }
}

$("btn-match").onclick = () =>
  guard(async () => {
    stopOffline();
    await net.quickMatch(playerName(), maxPlayers);
    net.ready(true);
    show("room");
  });

$("btn-practice").onclick = () => {
  startOffline();
};

$("btn-create").onclick = () =>
  guard(async () => {
    stopOffline();
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
$("btn-rules-close").onclick = () => {
  if (offline?.state.phase === "PLAYING" || net.state?.phase === "PLAYING")
    show("none");
  else show(net.room ? "room" : "lobby");
};
$("btn-guide-ok").onclick = () => {
  localStorage.setItem("jhd.guided", "1");
  show("none");
};
$("btn-help").onclick = () => show("rules");

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
  if (offline) {
    if (lastRound?.allDone) offline.start();
    else offline.continueRound();
    show("none");
    return;
  }
  net.nextRound();
  show("room");
};
$("btn-exit").onclick = () => {
  if (offline) {
    stopOffline();
    show("lobby");
    return;
  }
  guard(async () => {
    await net.leave();
    show("lobby");
  });
};

function renderResult(r: RoundOver): void {
  const state = offline?.state ?? net.state;
  const mySeat = offline ? offline.mySeat : net.mySeat;
  if (!state) return;
  const players = [...state.players.values()] as any[];
  const rows = players
    .map((p) => ({ p, points: r.points[p.seat], net: r.net[p.seat] }))
    .sort((a, b) => b.net - a.net);

  const title = $("result").querySelector(".title") as HTMLElement;
  const winner = rows[0];
  const iWin = winner?.p.seat === mySeat && winner.net >= 0;
  title.textContent = r.allDone
    ? iWin
      ? "最终结算 · 胜"
      : `最终结算（${r.totalRounds} 轮）`
    : `第 ${r.round} / ${r.totalRounds} 轮`;

  const dots = $("result-dots");
  if (dots) {
    dots.innerHTML = Array.from({ length: r.totalRounds }, (_, i) => {
      const on = i < r.round;
      return `<span class="dot${on ? " on" : ""}"></span>`;
    }).join("");
  }

  $("result-list").innerHTML = rows
    .map(
      (row, i) => `
      <div class="res${row.p.seat === mySeat ? " me" : ""}${
        i === 0 ? " top" : ""
      }">
        <span class="rank">${i === 0 ? "胜" : i + 1}</span>
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

  const btnAgain = $<HTMLButtonElement>("btn-again");
  const btnExit = $<HTMLButtonElement>("btn-exit");
  if (r.allDone) {
    btnAgain.textContent = offline ? "再练一局" : "再来一局";
    btnExit.style.display = "";
  } else {
    btnAgain.textContent = `继续下一轮 (${r.round}/${r.totalRounds})`;
    btnExit.style.display = "none";
    setTimeout(() => {
      if (shown("result")) show("none");
    }, ROUND_RESULT_AUTO_MS);
  }
  show("result");
}

// ---------- 出牌交互 ----------

function playState(): any {
  return offline?.state ?? net.state;
}

function myTurn(): boolean {
  if (offline) {
    const s = offline.state;
    return s.phase === "PLAYING" && s.currentSeat === offline.mySeat;
  }
  if (net.spectating) return false;
  return net.state?.phase === "PLAYING" && net.state.currentSeat === net.mySeat;
}

function pickHand(id: number): void {
  const state = playState();
  if (!myTurn() || !state || state.turnPhase !== "PLAY_HAND" || view.animating)
    return;
  const targets = findTargets(id, [...state.table]);

  if (targets.length === 1) return send(id, targets[0]);
  if (targets.length === 0) {
    if (discardArmed === id) return send(id);
    discardArmed = id;
    selected = id;
    syncSelection();
    hint("无可吃目标 — 再点一次弃牌");
    toast("再点一次确认弃牌");
    return;
  }
  selected = id;
  discardArmed = -1;
  syncSelection();
  hint("选择要吃的桌面牌");
}

function pickTable(id: number): void {
  const state = playState();
  if (!myTurn() || !state || view.animating) return;
  if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
    if (view.targets.includes(id)) {
      if (offline) offline.chooseTarget(id);
      else net.chooseTarget(id);
    }
    return;
  }
  if (selected < 0 || !view.targets.includes(id)) return;
  send(selected, id);
}

function send(cardId: number, targetId?: number): void {
  if (offline) {
    offline.play(cardId, targetId);
    offline.hand = offline.hand.filter((c) => c !== cardId);
  } else {
    net.play(cardId, targetId);
    net.hand = net.hand.filter((c) => c !== cardId);
  }
  selected = -1;
  discardArmed = -1;
  syncSelection();
  hint(null);
}

/** 同步选中态与可吃目标高亮 */
function syncSelection(): void {
  view.selected = selected;
  view.discardArmed = discardArmed;
  const state = playState();
  const mySeat = offline ? offline.mySeat : net.mySeat;
  if (!state) {
    view.targets = [];
    return;
  }
  if (state.turnPhase === "CHOOSE_STOCK_TARGET" && state.currentSeat === mySeat)
    view.targets = findTargets(state.pendingStockCard, [...state.table]);
  else if (selected >= 0)
    view.targets = findTargets(selected, [...state.table]);
  else view.targets = [];
}

function stopOffline(): void {
  offline?.stop();
  offline = null;
  $("emotes").classList.add("hidden");
}

function startOffline(): void {
  stopOffline();
  void net.leave().catch(() => undefined);
  const session = new LocalPlay(playerName(), aiDifficulty, 5);
  offline = session;
  session.onState = (state) => {
    view.state = state;
    view.hand = session.hand;
    view.mySeat = session.mySeat;
    if (state.phase === "PLAYING") {
      const overlay = shown("rules") || shown("guide");
      if (!overlay) show("none");
      $("emotes").classList.add("hidden");
      $("btn-help").classList.toggle("hidden", overlay);
      const mine = myTurn();
      if (mine && !wasMyTurn) sfx.turn();
      wasMyTurn = mine;
      if (!overlay) {
        if (mine)
          hint(
            state.turnPhase === "CHOOSE_STOCK_TARGET"
              ? "翻牌可吃，请选择目标"
              : "轮到你出牌"
          );
        else hint("电脑出牌中…");
      }
    }
    syncSelection();
  };
  session.onEvents = (events) => {
    view.pushEvents(events);
    view.hand = session.hand;
    for (const ev of events) {
      if (ev.target === undefined) sfx.discard();
      else if (ev.type === "FLIP")
        sfx.flipCapture(cardScore(ev.card) + cardScore(ev.target));
      else sfx.capture(cardScore(ev.card) + cardScore(ev.target));
    }
  };
  session.onRoundStart = () => {
    selected = -1;
    discardArmed = -1;
    lastRound = null;
    view.showCaptured = false;
    if (localStorage.getItem("jhd.guided") !== "1") show("guide");
    else show("none");
  };
  session.onRoundOver = (r) => {
    lastRound = {
      ...r,
      captured: [[], []],
    };
    const wait = () => {
      if (view.animating) return void setTimeout(wait, 120);
      sfx.roundOver();
      renderResult(lastRound!);
    };
    setTimeout(wait, 200);
  };
  session.start();
  toast("人机练习（离线）");
}

// ---------- 网络回调 ----------

net.onState = (state) => {
  if (offline) return;
  view.state = state;
  view.hand = net.hand;
  view.mySeat = net.mySeat;

  if (state.phase === "WAITING") {
    renderRoom(state);
    $("emotes").classList.add("hidden");
    $("btn-help").classList.add("hidden");
    if (
      !shown("result") &&
      !shown("rules") &&
      !shown("rank") &&
      !shown("guide")
    )
      show("room");
  } else if (state.phase === "PLAYING") {
    const overlay = shown("rules") || shown("rank") || shown("guide");
    if (!overlay) show("none");
    $("emotes").classList.toggle("hidden", overlay);
    $("btn-help").classList.toggle("hidden", overlay);
    const mine = myTurn();
    if (mine && !wasMyTurn) sfx.turn();
    wasMyTurn = mine;
    if (!overlay) {
      if (net.spectating) hint("观战中");
      else if (mine)
        hint(
          state.turnPhase === "CHOOSE_STOCK_TARGET"
            ? "翻牌可吃，请选择目标"
            : "轮到你出牌"
        );
      else hint(null);
    }
  }
  syncSelection();
};

net.onRoundStart = () => {
  selected = -1;
  discardArmed = -1;
  lastRound = null;
  view.showCaptured = false;
  if (localStorage.getItem("jhd.guided") !== "1") {
    show("guide");
  } else {
    show("none");
  }
};

net.onEvents = (events) => {
  if (offline) return;
  view.pushEvents(events);
  view.hand = net.hand;
  for (const ev of events) {
    if (ev.target === undefined) sfx.discard();
    else if (ev.type === "FLIP")
      sfx.flipCapture(cardScore(ev.card) + cardScore(ev.target));
    else sfx.capture(cardScore(ev.card) + cardScore(ev.target));
  }
};

net.onRoundOver = (r) => {
  if (offline) return;
  lastRound = r;
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

const EMOTE_ICON: Record<string, string> = {
  加油: "💪",
  好棋: "👏",
  厉害: "👍",
  等等: "⏳",
  哈哈哈: "😄",
};

let emoteTimer = 0;
net.onEmote = (e) => {
  const el = $("emote-bubble");
  const icon = EMOTE_ICON[e.id] ?? "💬";
  el.textContent = `${icon} ${e.name}：${e.id}`;
  el.classList.remove("hidden");
  clearTimeout(emoteTimer);
  emoteTimer = window.setTimeout(() => el.classList.add("hidden"), 3000);
};

net.onError = (msg) => {
  toast(msg);
  selected = -1;
  discardArmed = -1;
  syncSelection();
};

net.onLeave = () => {
  if (offline || lastRound) return;
  toast("已断开连接");
  show("lobby");
};

// 刷新页面后尝试回到原对局（纯静态托管时会静默失败）
if (!import.meta.env.VITE_OFFLINE_ONLY)
  net.tryReconnect().then((ok) => {
    if (ok) toast("已重连回到对局");
  });

if (import.meta.env.DEV) (window as any).__jhd = { net, view, get offline() { return offline; } };

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  view.hand = offline ? offline.hand : net.hand;
  view.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
