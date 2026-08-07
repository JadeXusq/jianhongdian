/**
 * 入口：界面切换与出牌交互
 * 交互约定：点手牌 → 唯一目标直接吃；多目标高亮待选；无目标需再点一次确认弃牌。
 */
import { cardScore, findTargets, turnHint } from "@jhd/shared";
import { ROUND_RESULT_MAX_WAIT_MS, ROUND_END_EVENT_GRACE_MS, TURN_UI_LOCK_MS } from "@jhd/shared";
import { sfx } from "./audio";
import { loadCardAtlas } from "./cardRender";
import { bindRotScroll, onOrientationChange, shouldRotate } from "./layout";
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
let selected = -1;
/** 无目标的牌需二次点击确认弃牌，避免误操作 */
let discardArmed = -1;
let lastRound: RoundOver | null = null;
/** 用于判断“刚轮到我”的边沿，避免每帧重复提醒 */
let wasMyTurn = false;
/** 刚切到自己回合、事件动画尚未入队时的短锁截止时间（墙钟） */
let turnUiLockUntil = 0;
/** 待展示的结算（等动画结束或超时） */
let pendingRoundOver: RoundOver | null = null;
let roundOverWaitStarted = 0;
let dealRoundPending = false;
let lastDealRound = 0;
let roomCodeMode: "join" | "spectate" = "join";

const assetBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
void loadCardAtlas(assetBase);

const view = new TableView($<HTMLCanvasElement>("table"), {
  onPickHand: (id) => pickHand(id),
  onPickTable: (id) => pickTable(id),
  onToggleCaptured: () => {
    view.showCaptured = !view.showCaptured;
  },
  onCancelSelection: () => clearSelection(),
  onDealSfx: (kind) => {
    if (kind === "shuffle") sfx.dealShuffle();
    else if (kind === "round") sfx.dealRound();
    else sfx.dealTable();
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
    | "game-menu"
    | "scores"
    | "settle-confirm"
    | "room-code-dialog"
    | "none"
): void {
  [
    "lobby",
    "room",
    "result",
    "rules",
    "rank",
    "account",
    "guide",
    "game-menu",
    "scores",
    "settle-confirm",
    "room-code-dialog",
  ].forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

const shown = (id: string) => !$(id).classList.contains("hidden");

/** 竖屏触屏设备全程软件旋转，保证大厅与牌桌方向一致 */
function applyOrientation(): void {
  $("ui").classList.toggle("rot", shouldRotate());
}
applyOrientation();
onOrientationChange(applyOrientation);

function bindOverlayScrolls(): void {
  [
    ".room-panel",
    ".rules-body",
    ".result-panel .result-list",
    "#rank .result-list",
    ".guide-panel .guide-list",
    ".lobby-panel",
    ".chat-log",
  ].forEach((sel) => {
    document.querySelectorAll<HTMLElement>(sel).forEach(bindRotScroll);
  });
}
bindOverlayScrolls();

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
let settleBack: "result" | "game-menu" = "game-menu";
let rulesBack: "lobby" | "room" | "result" | "game-menu" | "none" = "lobby";

function toast(msg: string, ms = 2200): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), ms);
}

function clearToast(): void {
  clearTimeout(toastTimer);
  $("toast").classList.add("hidden");
}

function hint(msg: string | null): void {
  const el = $("turn-hint");
  el.classList.toggle("hidden", !msg);
  if (msg) el.textContent = msg;
}

/** 按阶段整理回合提示，避免翻牌/结算动画误报「对手出牌中」 */
function refreshTurnHint(): void {
  const state = playState();
  if (!state || state.phase !== "PLAYING") return;
  if (
    shown("rules") ||
    shown("guide") ||
    shown("rank") ||
    shown("result") ||
    shown("game-menu") ||
    shown("scores") ||
    shown("settle-confirm")
  )
    return;

  const spectating = !offline && net.spectating;
  const mine = myTurn();
  const now = performance.now();

  // 状态已切到自己，但 onEvents 可能晚一拍：用墙钟短锁等动画入队（不依赖 RAF 帧数）
  if (mine && !wasMyTurn && !view.animating && turnUiLockUntil === 0)
    turnUiLockUntil = now + TURN_UI_LOCK_MS;
  if (view.animating) turnUiLockUntil = 0;
  if (turnUiLockUntil > 0 && now >= turnUiLockUntil) turnUiLockUntil = 0;

  const busy = view.animating || now < turnUiLockUntil;
  view.turnBlocked = busy;

  const text = turnHint({
    spectating,
    offline: !!offline,
    myTurn: mine,
    turnPhase: state.turnPhase,
    busy,
    pickingTable: selected >= 0 && discardArmed < 0,
    discardConfirm: discardArmed >= 0,
  });

  if (!spectating && mine && !busy) {
    if (!wasMyTurn) sfx.turn();
    wasMyTurn = true;
  } else {
    wasMyTurn = false;
  }
  hint(text);
}

/** 动画结束后展示结算；超时强制弹出，避免节流导致一直等 */
function flushRoundOverIfReady(): boolean {
  if (!pendingRoundOver) return false;
  const waited = performance.now() - roundOverWaitStarted;
  if (waited < ROUND_END_EVENT_GRACE_MS) return false;
  if (view.animating && waited < ROUND_RESULT_MAX_WAIT_MS) return false;
  const r = pendingRoundOver;
  pendingRoundOver = null;
  view.roundEnding = false;
  sfx.roundOver();
  renderResult(r);
  return true;
}

function tryStartDealAnim(): void {
  if (!dealRoundPending) return;
  if (view.tryDealAnim()) dealRoundPending = false;
}

function armDealRound(): void {
  dealRoundPending = true;
  view.prepDealAnim();
  tryStartDealAnim();
}

function onDealRoundStart(): void {
  selected = -1;
  discardArmed = -1;
  lastRound = null;
  view.showCaptured = false;
  view.roundEnding = false;
  clearToast();
  hint(null);
}

function applyPlayState(state: any, hand: number[], mySeat: number): void {
  const prev = view.state;
  view.deferStateArrivals(prev, state);
  view.state = state;
  view.hand = hand;
  view.mySeat = mySeat;
  const newRound =
    state.phase === "PLAYING" &&
    (state.round !== lastDealRound || prev?.phase === "ROUND_OVER");
  if (newRound) {
    lastDealRound = state.round;
    pendingRoundOver = null;
    view.resetAnimVisuals();
    armDealRound();
  } else if (dealRoundPending) {
    view.syncDealHidden();
  }
  tryStartDealAnim();
}

function ensureDealAnimForRound(): void {
  const state = playState();
  if (!state || state.phase !== "PLAYING") return;
  if (view.animating) return;
  if (dealRoundPending) {
    view.syncDealHidden();
    tryStartDealAnim();
    return;
  }
  if (state.round === lastDealRound) return;
  pendingRoundOver = null;
  lastDealRound = state.round;
  view.resetAnimVisuals();
  armDealRound();
}

function queueRoundOver(r: RoundOver): void {
  lastRound = r;
  pendingRoundOver = r;
  roundOverWaitStarted = performance.now();
  view.roundEnding = true;
  setTimeout(() => flushRoundOverIfReady(), ROUND_END_EVENT_GRACE_MS);
  const poll = () => {
    if (!pendingRoundOver) return;
    if (flushRoundOverIfReady()) return;
    setTimeout(poll, 120);
  };
  setTimeout(poll, 320);
}

// ---------- 大厅 ----------

const nameInput = $<HTMLInputElement>("name");
nameInput.value = localStorage.getItem("jhd.name") ?? "";

function playerName(): string {
  const raw = nameInput.value.trim().slice(0, 10);
  const v = raw || "无名客";
  if (nameInput.value !== raw) nameInput.value = raw;
  localStorage.setItem("jhd.name", v === "无名客" ? raw : v);
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
    clearChatLog();
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
    clearChatLog();
    await net.create(playerName(), maxPlayers);
    show("room");
  });

function openRoomCodeDialog(mode: "join" | "spectate"): void {
  roomCodeMode = mode;
  $("room-code-title").textContent = mode === "join" ? "加入房间" : "观战房间";
  $("btn-room-code-ok").textContent = mode === "join" ? "确认加入" : "确认观战";
  const input = $<HTMLInputElement>("room-code-input");
  input.value = "";
  show("room-code-dialog");
  requestAnimationFrame(() => input.focus());
}

async function submitRoomCode(): Promise<void> {
  const input = $<HTMLInputElement>("room-code-input");
  const code = input.value.replace(/\D/g, "").slice(0, 6);
  input.value = code;
  if (code.length !== 6) {
    toast("请输入 6 位房号");
    input.focus();
    return;
  }
  stopOffline();
  clearChatLog();
  if (roomCodeMode === "join") {
    await net.joinByCode(playerName(), code);
    show("room");
    return;
  }
  await net.spectateByCode(playerName(), code);
  toast("已进入观战");
  show("none");
}

$("btn-join").onclick = () => openRoomCodeDialog("join");
$("btn-spectate").onclick = () => openRoomCodeDialog("spectate");
$("btn-room-code-cancel").onclick = () => show("lobby");
$("btn-room-code-ok").onclick = () =>
  guard(async () => {
    await submitRoomCode();
  });
$<HTMLInputElement>("room-code-input").addEventListener("input", (e) => {
  const input = e.currentTarget as HTMLInputElement;
  input.value = input.value.replace(/\D/g, "").slice(0, 6);
});
$<HTMLInputElement>("room-code-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") void guard(submitRoomCode);
});

function openRules(from: typeof rulesBack = "lobby"): void {
  rulesBack = from;
  show("rules");
  setChatPanelOpen(false);
  $("btn-help").classList.add("hidden");
  $("btn-rules-ok").classList.toggle(
    "hidden",
    from !== "lobby" && from !== "room"
  );
}

function closeRules(): void {
  const back = rulesBack;
  if (back === "none") {
    show("none");
    restoreTableChrome();
    return;
  }
  show(back);
  if (back === "result") {
    const mid = !!lastRound && !lastRound.allDone;
    const showChrome = mid && (!net.spectating || !!offline);
    $("btn-help").classList.toggle("hidden", !showChrome);
    setMenuVisible(showChrome);
    return;
  }
  if (back === "game-menu") $("btn-help").classList.add("hidden");
}

function restoreTableChrome(): void {
  const state = playState();
  const playing = state?.phase === "PLAYING";
  const midRound =
    state?.phase === "ROUND_OVER" && !!lastRound && !lastRound.allDone;
  const showChrome = (playing || midRound) && (!net.spectating || !!offline);
  $("btn-help").classList.toggle("hidden", !showChrome);
  setMenuVisible(showChrome);
}

$("btn-rules").onclick = () => openRules(net.room ? "room" : "lobby");
$("btn-rules-close").onclick = () => closeRules();
$("btn-rules-ok").onclick = () => closeRules();
$("btn-guide-ok").onclick = () => {
  localStorage.setItem("jhd.guided", "1");
  show("none");
  restoreTableChrome();
};
$("btn-help").onclick = () => openRules(shown("result") ? "result" : "none");

function isHost(): boolean {
  if (offline) return true;
  if (!net.room || !net.state) return false;
  return net.state.hostSessionId === net.room.sessionId;
}

function setMenuVisible(v: boolean): void {
  $("btn-menu").classList.toggle("hidden", !v);
  if (v) setChatPanelOpen(false);
}

function openGameMenu(): void {
  const canSettle = isHost() && !lastRound?.allDone;
  $("btn-menu-settle").classList.toggle("hidden", !canSettle);
  setChatPanelOpen(false);
  show("game-menu");
}

function renderScores(): void {
  const state = playState();
  if (!state) return;
  const players = [...state.players.values()] as any[];
  const rows = [...players].sort((a, b) => b.totalNet - a.totalNet);
  const mySeat = offline ? offline.mySeat : net.mySeat;
  $("scores-round").textContent = !state.round
    ? "尚未完成轮次"
    : state.phase === "PLAYING"
      ? `第 ${state.round} 轮进行中 · 累计净分`
      : `已完成 ${state.round} 轮 · 累计净分`;
  $("scores-list").innerHTML = rows
    .map(
      (p, i) => `
      <div class="res${p.seat === mySeat ? " me" : ""}${i === 0 ? " top" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">${p.name}${
        p.isAi && !String(p.name).startsWith("机器人")
          ? '<span class="ai-tag">机</span>'
          : ""
      }</span>
        <span class="calc">本轮 ${p.points}</span>
        <span class="net ${
          p.totalNet > 0 ? "win" : p.totalNet < 0 ? "lose" : ""
        }">${p.totalNet > 0 ? "+" : ""}${p.totalNet}</span>
      </div>`
    )
    .join("");
  show("scores");
}

$("btn-menu").onclick = () => openGameMenu();
$("btn-menu-close").onclick = () => {
  show("none");
  restoreTableChrome();
};
$("btn-menu-scores").onclick = () => renderScores();
$("btn-scores-close").onclick = () => {
  show("none");
  restoreTableChrome();
};
$("btn-menu-settle").onclick = () => {
  settleBack = "game-menu";
  show("settle-confirm");
};
$("btn-result-settle").onclick = () => {
  settleBack = "result";
  show("settle-confirm");
};
$("btn-settle-cancel").onclick = () => show(settleBack);
$("btn-settle-ok").onclick = () => {
  if (offline) {
    view.resetAnimVisuals();
    offline.endMatch();
    show("none");
    return;
  }
  net.endMatch();
  show("none");
};

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
$("btn-rank-back").onclick = () => show("lobby");

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
    $(
      "account-hint"
    ).textContent = `请妥善保存凭证（只显示一次）：${data.token}`;
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
    $(
      "account-hint"
    ).textContent = `战绩已合并：${profile.games} 局 · 净分 ${profile.totalNet}`;
    toast("绑定成功，战绩已合并");
  });

// ---------- 房间 ----------

$("btn-ai").onclick = () => net.addAi();
$("btn-ready").onclick = () => {
  const me = net.state?.players.get(net.room!.sessionId);
  net.ready(!me?.ready);
};
$("btn-quit").onclick = () =>
  guard(async () => {
    await net.leave();
    show("lobby");
  });

function listRoomPlayers(state: any): Array<{
  sessionId: string;
  name: string;
  seat: number;
  isAi: boolean;
  ready: boolean;
}> {
  const out: Array<{
    sessionId: string;
    name: string;
    seat: number;
    isAi: boolean;
    ready: boolean;
  }> = [];
  const seen = new Set<string>();
  state.players.forEach((p: any, id: string) => {
    const sessionId = String(id || p.sessionId || "");
    if (!sessionId || seen.has(sessionId)) return;
    seen.add(sessionId);
    out.push({
      sessionId,
      name: String(p.name || "玩家"),
      seat: Number(p.seat) || 0,
      isAi: !!p.isAi,
      ready: !!p.ready,
    });
  });
  return out.sort((a, b) => a.seat - b.seat);
}

function renderRoom(state: any): void {
  $("room-code").textContent = state.code;
  const seats = $("seats");
  seats.innerHTML = "";
  const players = listRoomPlayers(state);
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const nameCount = new Map<string, number>();
  for (const p of players)
    nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);

  for (let i = 0; i < state.maxPlayers; i++) {
    const p = bySeat.get(i);
    const div = document.createElement("div");
    div.className = "seat" + (p ? "" : " empty");
    if (p) {
      const dup = (nameCount.get(p.name) ?? 0) > 1;
      const label = dup ? `${p.name}·座${i + 1}` : p.name;
      const mine = p.sessionId === net.room?.sessionId;
      div.innerHTML = `<div class="avatar">${label.slice(0, 1)}</div>
         <div class="who">${label}${
        p.isAi && !String(p.name).startsWith("机器人")
          ? '<span class="ai-tag">机</span>'
          : ""
      }${mine ? "（我）" : ""}</div>
         <div class="tag">${p.ready ? "已准备" : "等待中"}</div>`;
    } else {
      div.innerHTML = `<div class="avatar">＋</div><div class="who">座位 ${
        i + 1
      } · 空</div>`;
    }
    seats.appendChild(div);
  }

  const need = state.maxPlayers - players.length;
  const unready = players.filter((p) => !p.ready).length;
  const status = $("room-status");
  if (need > 0) {
    status.textContent = `还差 ${need} 人（可点「添加机器人」补位）`;
  } else if (unready > 0) {
    status.textContent = `人数已满 · 还有 ${unready} 人未准备`;
  } else {
    status.textContent = "全员已准备 · 即将开局";
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
  pendingRoundOver = null;
  if (offline) {
    if (lastRound?.allDone) offline.start();
    else offline.continueRound();
    show("none");
    return;
  }
  net.nextRound();
  if (lastRound && !lastRound.allDone) toast("已确认，等待其他玩家…");
  show("none");
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
      : `最终结算（${r.round} 轮）`
    : `第 ${r.round} 轮`;

  const dots = $("result-dots");
  if (dots) {
    if (r.allDone && r.round > 0) {
      dots.innerHTML = Array.from({ length: r.round }, (_, i) => {
        return `<span class="dot on"></span>`;
      }).join("");
    } else {
      dots.innerHTML = `<span class="dot on"></span>`;
    }
  }

  $("result-list").innerHTML = rows
    .map(
      (row, i) => `
      <div class="res${row.p.seat === mySeat ? " me" : ""}${
        i === 0 ? " top" : ""
      }">
        <span class="rank">${i === 0 ? "胜" : i + 1}</span>
        <span class="who">${row.p.name}${
        row.p.isAi && !String(row.p.name).startsWith("机器人")
          ? '<span class="ai-tag">机</span>'
          : ""
      }</span>
        <span class="calc">${row.points} − ${r.base}${
        r.allDone || row.p.totalNet !== undefined
          ? " | 总 " + row.p.totalNet
          : ""
      }</span>
        <span class="net ${row.net > 0 ? "win" : row.net < 0 ? "lose" : ""}">${
        row.net > 0 ? "+" : ""
      }${row.net}</span>
      </div>`
    )
    .join("");

  const btnAgain = $<HTMLButtonElement>("btn-again");
  const btnExit = $<HTMLButtonElement>("btn-exit");
  const btnSettle = $<HTMLButtonElement>("btn-result-settle");
  if (r.allDone) {
    btnAgain.textContent = offline ? "再练一局" : "再来一局";
    btnAgain.classList.add("primary");
    btnExit.style.display = "";
    btnSettle.classList.add("hidden");
    setMenuVisible(false);
  } else {
    btnAgain.textContent = "继续下一轮";
    btnAgain.classList.remove("primary");
    btnExit.style.display = "none";
    btnSettle.classList.toggle("hidden", !offline && !isHost());
    btnSettle.classList.add("primary");
    setMenuVisible(!net.spectating || !!offline);
  }
  show("result");
  $("btn-help").classList.toggle(
    "hidden",
    !(!r.allDone && (!net.spectating || !!offline))
  );
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
  if (
    !myTurn() ||
    !state ||
    state.turnPhase !== "PLAY_HAND" ||
    view.animating ||
    view.turnBlocked
  )
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
  if (!state || view.animating || view.turnBlocked) return;
  if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
    if (!myTurn()) return;
    if (view.targets.includes(id)) {
      if (offline) offline.chooseTarget(id);
      else net.chooseTarget(id);
    }
    return;
  }
  if (!myTurn()) return;
  if (selected < 0 || !view.targets.includes(id)) return;
  send(selected, id);
}

function clearSelection(): void {
  if (selected < 0 && discardArmed < 0) return;
  selected = -1;
  discardArmed = -1;
  syncSelection();
  hint(null);
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
  clearToast();
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
  // 动画中不亮可出/可吃，避免“已轮到你”的错觉
  if (view.animating || view.turnBlocked) {
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
  $("btn-chat-toggle").classList.add("hidden");
  clearChatLog();
  setMenuVisible(false);
}

function startOffline(): void {
  stopOffline();
  clearChatLog();
  void net.leave().catch(() => undefined);
  const session = new LocalPlay(playerName(), maxPlayers);
  offline = session;
  session.onState = (state) => {
    applyPlayState(state, session.hand, session.mySeat);
    if (state.phase === "PLAYING") {
      const overlay =
        shown("rules") ||
        shown("guide") ||
        shown("game-menu") ||
        shown("scores") ||
        shown("settle-confirm");
      if (!overlay) show("none");
      $("emotes").classList.toggle("hidden", overlay);
      $("btn-chat-toggle").classList.toggle("hidden", overlay);
      if (overlay) setChatPanelOpen(false);
      $("btn-help").classList.toggle("hidden", overlay);
      setMenuVisible(!overlay);
      if (!overlay) refreshTurnHint();
    } else if (state.phase === "ROUND_OVER") {
      $("emotes").classList.add("hidden");
      $("btn-chat-toggle").classList.remove("hidden");
      setChatPanelOpen(false);
      setMenuVisible(!lastRound?.allDone);
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
    onDealRoundStart();
    view.hand = session.hand;
    if (localStorage.getItem("jhd.guided") !== "1") show("guide");
    else show("none");
  };
  session.onRoundOver = (r) => {
    queueRoundOver({
      ...r,
      captured: [[], []],
    });
  };
  session.start();
  toast(`人机练习（离线）· ${maxPlayers} 人`);
}

// ---------- 网络回调 ----------

net.onState = (state) => {
  if (offline) return;
  applyPlayState(state, net.hand, net.mySeat);

  if (state.phase === "WAITING") {
    renderRoom(state);
    $("emotes").classList.add("hidden");
    $("btn-chat-toggle").classList.remove("hidden");
    $("btn-help").classList.add("hidden");
    setMenuVisible(false);
    if (
      !shown("result") &&
      !shown("rules") &&
      !shown("rank") &&
      !shown("guide")
    )
      show("room");
  } else if (state.phase === "PLAYING") {
    const overlay =
      shown("rules") ||
      shown("rank") ||
      shown("guide") ||
      shown("game-menu") ||
      shown("scores") ||
      shown("settle-confirm");
    if (!overlay) show("none");
    $("emotes").classList.toggle("hidden", overlay);
    $("btn-chat-toggle").classList.toggle("hidden", overlay);
    if (overlay) setChatPanelOpen(false);
    $("btn-help").classList.toggle("hidden", overlay);
    setMenuVisible(!overlay && !net.spectating);
    if (!overlay) refreshTurnHint();
  } else if (state.phase === "ROUND_OVER") {
    $("emotes").classList.add("hidden");
    $("btn-chat-toggle").classList.remove("hidden");
    setChatPanelOpen(false);
    $("btn-help").classList.toggle("hidden", net.spectating);
    setMenuVisible(!net.spectating && !lastRound?.allDone);
  }
  syncSelection();
};

net.onRoundStart = () => {
  onDealRoundStart();
  view.hand = net.hand;
  ensureDealAnimForRound();
  if (localStorage.getItem("jhd.guided") !== "1") {
    show("guide");
  } else {
    show("none");
  }
};

net.onHand = () => {
  if (offline) return;
  view.hand = net.hand;
  if (dealRoundPending) view.syncDealHidden();
  tryStartDealAnim();
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
  queueRoundOver(r);
};

const EMOTE_ICON: Record<string, string> = {
  加油: "💪",
  好牌: "👏",
  厉害: "👍",
  等等: "⏳",
  哈哈哈: "😄",
};
const EMOTE_COOLDOWN_MS = 1200;
const CHAT_COOLDOWN_MS = 1200;
let lastEmoteAt = 0;
let lastChatAt = 0;
let emoteTimer = 0;

// ---------- 聊天记录 ----------
interface ChatEntry {
  seat: number;
  name: string;
  text: string;
  isEmote: boolean;
  mine: boolean;
}
const chatLog: ChatEntry[] = [];
const CHAT_MAX_ENTRIES = 200;
let chatUnread = 0;

function clearChatLog(): void {
  chatLog.length = 0;
  chatUnread = 0;
  renderChatLog();
  updateChatBadge();
  $("chat-panel").classList.add("hidden");
}

function isChatOpen(): boolean {
  return !$("chat-panel").classList.contains("hidden");
}

function updateChatBadge(): void {
  const badge = $("chat-unread");
  if (!badge) return;
  if (chatUnread <= 0) {
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }
  badge.textContent = chatUnread > 99 ? "99+" : String(chatUnread);
  badge.classList.remove("hidden");
}

function addChatEntry(e: ChatEntry): void {
  chatLog.push(e);
  if (chatLog.length > CHAT_MAX_ENTRIES) chatLog.shift();
  if (!e.mine && !isChatOpen()) chatUnread += 1;
  renderChatLog();
  updateChatBadge();
}

function renderChatLog(): void {
  const log = $("chat-log");
  if (!log) return;
  log.innerHTML = chatLog
    .map((e) => {
      const icon = e.isEmote ? EMOTE_ICON[e.text] ?? "💬" : "";
      const cls = `chat-msg${e.mine ? " chat-mine" : ""}`;
      const text = e.isEmote
        ? `<span class="chat-emote">${icon} ${e.text}</span>`
        : escapeHtml(e.text);
      return `<div class="${cls}"><span class="chat-name">${escapeHtml(
        e.name
      )}</span>${text}</div>`;
    })
    .join("");
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setChatPanelOpen(open: boolean): void {
  $("chat-panel").classList.toggle("hidden", !open);
  if (open) {
    chatUnread = 0;
    updateChatBadge();
    renderChatLog();
  }
}

function toggleChatPanel(): void {
  setChatPanelOpen(!isChatOpen());
}

function sendChat(): void {
  const input = $("chat-input") as HTMLInputElement;
  const text = input.value.trim().slice(0, 200);
  if (!text) return;
  const now = Date.now();
  if (now - lastChatAt < CHAT_COOLDOWN_MS) {
    toast("发送太快了");
    return;
  }
  if (offline) {
    lastChatAt = now;
    input.value = "";
    addChatEntry({
      seat: offline.mySeat,
      name: playerName(),
      text,
      isEmote: false,
      mine: true,
    });
    return;
  }
  if (!net.room) {
    toast("未连接房间");
    return;
  }
  lastChatAt = now;
  input.value = "";
  net.chat(text);
}

$("btn-chat-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleChatPanel();
});
$("btn-chat-close").addEventListener("click", () => setChatPanelOpen(false));
$("btn-chat-send").addEventListener("click", sendChat);
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChat();
  }
});

function showEmoteBubble(name: string, id: string): void {
  const el = $("emote-bubble");
  const icon = EMOTE_ICON[id] ?? "💬";
  el.textContent = `${icon} ${name}：${id}`;
  el.classList.remove("hidden");
  clearTimeout(emoteTimer);
  emoteTimer = window.setTimeout(() => el.classList.add("hidden"), 2800);
}

function sendEmote(id: string): void {
  if (!EMOTE_ICON[id]) return;
  const now = Date.now();
  if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) {
    toast("发送太快了");
    return;
  }
  lastEmoteAt = now;
  if (offline) {
    addChatEntry({
      seat: offline.mySeat,
      name: playerName(),
      text: id,
      isEmote: true,
      mine: true,
    });
    showEmoteBubble(playerName(), id);
    return;
  }
  if (!net.room) {
    toast("未连接房间");
    return;
  }
  net.emote(id);
}

$("emotes").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const id = (btn as HTMLButtonElement).dataset.e;
  if (id) sendEmote(id);
});

net.onEmote = (e) => {
  showEmoteBubble(e.name, e.id);
  const mine = e.seat === (offline?.mySeat ?? net.mySeat);
  addChatEntry({
    seat: e.seat,
    name: e.name,
    text: e.id,
    isEmote: true,
    mine,
  });
};

net.onChat = (e) => {
  const mine = e.seat === (offline?.mySeat ?? net.mySeat);
  addChatEntry({
    seat: e.seat,
    name: e.name,
    text: e.text,
    isEmote: false,
    mine,
  });
};

net.onError = (msg) => {
  toast(msg);
  selected = -1;
  discardArmed = -1;
  syncSelection();
};

net.onLeave = () => {
  clearChatLog();
  $("btn-chat-toggle").classList.add("hidden");
  if (offline || lastRound) return;
  toast("已断开连接");
  show("lobby");
};

// 刷新页面后尝试回到原对局（纯静态托管时会静默失败）
if (!import.meta.env.VITE_OFFLINE_ONLY)
  net.tryReconnect().then((ok) => {
    if (ok) toast("已重连回到对局");
  });

if (import.meta.env.DEV)
  (window as any).__jhd = {
    net,
    view,
    get offline() {
      return offline;
    },
  };

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if ($("ui").classList.contains("rot") !== shouldRotate()) applyOrientation();
  try {
    view.hand = offline ? offline.hand : net.hand;
    if (dealRoundPending) view.syncDealHidden();
    if (dealRoundPending) tryStartDealAnim();
    view.render(dt);
    flushRoundOverIfReady();
    if (playState()?.phase === "PLAYING") {
      syncSelection();
      refreshTurnHint();
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error("[jhd] frame", e);
  } finally {
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);
