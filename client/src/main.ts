/**
 * 入口：界面切换与出牌交互
 * 交互约定：点手牌 → 唯一目标直接吃；多目标高亮待选；无目标需再点一次确认弃牌。
 */
import {
  autoTarget,
  cardName,
  dealOpenMs,
  findTargets,
  isRed,
  turnHint,
  THEMES,
  ROUND_RESULT_MAX_WAIT_MS,
  ROUND_END_EVENT_GRACE_MS,
  TURN_UI_LOCK_MS,
} from "@jhd/shared";
import { sfx } from "./audio";
import { loadCardAtlas } from "./cardRender";
import { bindRotScroll, lockLandscape, onOrientationChange, shouldRotate } from "./layout";
import { LocalPlay, hasLocalSave } from "./localPlay";
import { Net, RoundOver, deviceId, savedAccountId } from "./net";
import { TableView } from "./table";
import { applyTheme, currentThemeId, loadSavedTheme, type ThemeId } from "./theme";
import { loadThemeArt, themePreviewUrl } from "./themeArt";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

applyTheme(loadSavedTheme());

const net = new Net();
net.onProgress = (msg) => toast(msg, 5000);
/** 离线人机会话；有值时走浏览器内规则，不连服务器 */
let offline: LocalPlay | null = null;
let maxPlayers = 4;
let selected = -1;
/** 无目标的牌需二次点击确认弃牌，避免误操作 */
let discardArmed = -1;
let lastRound: RoundOver | null = null;
/** 本场各轮净胜分：matchRoundNets[roundIndex][seat] */
let matchRoundNets: number[][] = [];
type ScorePlayer = {
  seat: number;
  name: string;
  isAi?: boolean;
  totalNet: number;
};
const MATCH_SAVE_KEY = "jhd.onlineMatch";
let lastScorePlayers: ScorePlayer[] = [];
let lastScoreMySeat = 0;
let lastScoreRound = 0;
let lastScoreCode = "";
let lastLivePoints: number[] = [];
let matchDetached = false;
/** 用于判断“刚轮到我”的边沿，避免每帧重复提醒 */
let wasMyTurn = false;
/** 刚切到自己回合、事件动画尚未入队时的短锁截止时间（墙钟） */
let turnUiLockUntil = 0;
/** 已提交出牌/选目标，等动画或阶段切换后再解锁 */
let playLocked = false;
let playAwaitingAnim = false;
let playLockAt = 0;
const PLAY_LOCK_FALLBACK_MS = 2500;
/** 待展示的结算（等动画结束或超时） */
let pendingRoundOver: RoundOver | null = null;
let roundOverWaitStarted = 0;
let dealRoundPending = false;
let lastDealRound = 0;
/** 发牌+看牌结束墙钟（此前进攻屏蔽） */
let handLookUntil = 0;
let roomCodeMode: "join" | "spectate" = "join";

const assetBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
void loadCardAtlas(assetBase);
void loadThemeArt(assetBase).then(() => {
  document.querySelectorAll<HTMLElement>(".theme-seg button[data-theme]").forEach((btn) => {
    const id = btn.dataset.theme;
    if (!id) return;
    btn.style.setProperty(
      "--theme-preview",
      `url(${themePreviewUrl(id as ThemeId, assetBase)})`
    );
  });
});
sfx.setTheme(currentThemeId());

const view = new TableView($<HTMLCanvasElement>("table"), {
  onPickHand: (id) => pickHand(id),
  onPickTable: (id) => pickTable(id),
  onToggleCaptured: () => {
    view.showCaptured = !view.showCaptured;
  },
  onCancelSelection: () => clearSelection(),
  onReorderHand: (order) => adoptHand(order, true),
  onDealSfx: (kind) => {
    if (kind === "shuffle") sfx.dealShuffle();
    else if (kind === "round") sfx.dealRound();
    else sfx.dealTable();
  },
  onCaptureSfx: (score) => {
    if (score > 0) sfx.capture(score);
  },
});

/** 保留已有手牌顺序，新牌追加到末尾 */
function mergeHandOrder(prev: number[], next: number[]): number[] {
  const nextSet = new Set(next);
  const kept = prev.filter((id) => nextSet.has(id));
  const keptSet = new Set(kept);
  const added = next.filter((id) => !keptSet.has(id));
  return [...kept, ...added];
}

function adoptHand(next: number[], exact = false): void {
  const order = exact ? [...next] : mergeHandOrder(view.hand, next);
  view.hand = order;
  if (offline) offline.hand = [...order];
  else net.hand = [...order];
}

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
  if (id === "lobby") {
    refreshPracticeBtn();
    refreshLastMatchBtn();
    void refreshResumeBtn();
  }
}

const shown = (id: string) => !$(id).classList.contains("hidden");

function applyOrientation(): void {
  const rot = shouldRotate();
  $("ui").classList.toggle("rot", rot);
  document.getElementById("overlay-layer")?.classList.toggle("rot", rot);
}
applyOrientation();
onOrientationChange(applyOrientation);

function bindOverlayScrolls(): void {
  [
    ".room-panel",
    ".rules-body",
    ".result-panel .result-list",
    ".scores-panel .result-list",
    "#rank .result-list",
    ".guide-panel .guide-list",
    ".lobby-panel",
    ".chat-log",
    ".phrase-scroll",
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
    lockLandscape();
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

  const looking = now < handLookUntil;
  if (playLocked && view.animating) playAwaitingAnim = false;
  if (playLocked && !view.animating && !looking) {
    if (
      !playAwaitingAnim &&
      (!mine || state.turnPhase === "CHOOSE_STOCK_TARGET")
    )
      unlockPlay();
    else if (now - playLockAt > PLAY_LOCK_FALLBACK_MS) unlockPlay();
  }
  const busy =
    view.animating || now < turnUiLockUntil || looking || playLocked;
  view.turnBlocked = busy;

  if (looking && !view.animating) {
    const left = Math.max(1, Math.ceil((handLookUntil - now) / 1000));
    hint(`看牌中 · ${left}s 后开局`);
    wasMyTurn = false;
    return;
  }

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
  if (view.settleBusy && waited < ROUND_RESULT_MAX_WAIT_MS) return false;
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
  const n = playState()?.maxPlayers ?? maxPlayers;
  handLookUntil = performance.now() + dealOpenMs(n);
  tryStartDealAnim();
}

function onDealRoundStart(): void {
  unlockPlay();
  selected = -1;
  discardArmed = -1;
  lastRound = null;
  view.showCaptured = false;
  view.roundEnding = false;
  view.hand = [];
  clearToast();
  hint(null);
}

function applyPlayState(state: any, hand: number[], mySeat: number): void {
  const prev = view.state;
  view.deferStateArrivals(prev, state);
  view.state = state;
  adoptHand(hand);
  view.mySeat = mySeat;
  if (!offline && (state.phase === "PLAYING" || state.phase === "ROUND_OVER"))
    rememberScoreCast(state, mySeat);
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

function rememberRoundNets(r: RoundOver): void {
  if (r.roundNets?.length) {
    matchRoundNets = r.roundNets.map((row) => [...row]);
    persistOnlineMatch();
    return;
  }
  // 纯结算收场（无本轮对局数据）不追加
  if (r.allDone && r.base === 0) return;
  if (r.round > 0) {
    matchRoundNets[r.round - 1] = [...r.net];
    matchRoundNets.length = r.round;
  }
  persistOnlineMatch();
}

function scorePlayersFromState(state: any): ScorePlayer[] {
  return [...state.players.values()].map((p: any) => ({
    seat: Number(p.seat) || 0,
    name: String(p.name || "玩家"),
    isAi: !!p.isAi,
    totalNet: Number(p.totalNet) || 0,
  }));
}

function rememberScoreCast(state: any, mySeat: number): void {
  if (offline) return;
  lastScorePlayers = scorePlayersFromState(state);
  lastScoreMySeat = mySeat;
  lastScoreCode = String(state.code || lastScoreCode);
  lastScoreRound = Number(state.round) || 0;
  if (state.phase === "PLAYING") {
    const live: number[] = [];
    state.players.forEach((p: any) => {
      live[Number(p.seat) || 0] = Number(p.points) || 0;
    });
    lastLivePoints = live;
  } else {
    lastLivePoints = [];
  }
  persistOnlineMatch();
}

type MatchSave = {
  v: number;
  code: string;
  mySeat: number;
  players: ScorePlayer[];
  roundNets: number[][];
  round: number;
  lastRound: RoundOver | null;
  livePoints: number[];
  ts: number;
};

function persistOnlineMatch(): void {
  if (offline) return;
  if (!lastScorePlayers.length && !matchRoundNets.length && !lastRound)
    return;
  if (
    lastScoreRound < 1 &&
    !matchRoundNets.length &&
    !lastRound
  )
    return;
  const data: MatchSave = {
    v: 1,
    code: lastScoreCode,
    mySeat: lastScoreMySeat,
    players: lastScorePlayers.map((p) => ({ ...p })),
    roundNets: matchRoundNets.map((row) => [...row]),
    round: lastScoreRound,
    lastRound: lastRound
      ? {
          ...lastRound,
          points: [...lastRound.points],
          net: [...lastRound.net],
          captured: (lastRound.captured ?? []).map((c) => [...c]),
          roundNets: lastRound.roundNets?.map((row) => [...row]),
        }
      : null,
    livePoints: [...lastLivePoints],
    ts: Date.now(),
  };
  try {
    localStorage.setItem(MATCH_SAVE_KEY, JSON.stringify(data));
  } catch {
    /* 配额满时忽略 */
  }
  refreshLastMatchBtn();
}

function readOnlineMatch(): MatchSave | null {
  try {
    const raw = localStorage.getItem(MATCH_SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as MatchSave;
    if (!data || data.v !== 1 || !Array.isArray(data.players)) return null;
    return data;
  } catch {
    return null;
  }
}

function hasOnlineMatchSave(): boolean {
  const s = readOnlineMatch();
  if (!s) return false;
  return !!(
    s.roundNets?.length ||
    s.lastRound ||
    s.round > 0 ||
    s.livePoints?.some((n) => n)
  );
}

function refreshLastMatchBtn(): void {
  const btn = document.getElementById("btn-last-match");
  if (!btn) return;
  btn.classList.toggle("hidden", !hasOnlineMatchSave());
}

async function refreshResumeBtn(): Promise<void> {
  const btn = document.getElementById("btn-resume-match");
  if (!btn) return;
  if (offline || net.room || import.meta.env.VITE_OFFLINE_ONLY) {
    btn.classList.add("hidden");
    return;
  }
  const hit = await net.activeMatch();
  btn.classList.toggle("hidden", !hit);
}

function adoptOnlineMatch(s: MatchSave): void {
  lastScorePlayers = s.players.map((p) => ({ ...p }));
  lastScoreMySeat = s.mySeat;
  lastScoreCode = s.code;
  lastScoreRound = s.round;
  lastLivePoints = [...(s.livePoints ?? [])];
  matchRoundNets = (s.roundNets ?? []).map((row) => [...row]);
  lastRound = s.lastRound;
}

function savedMatchTitle(reason: "disconnect" | "review"): string {
  const done = matchRoundNets.length;
  const inPlay =
    !!lastLivePoints.some((x) => x) || lastScoreRound > done;
  if (reason === "disconnect") {
    if (inPlay && lastScoreRound)
      return `连接已断开 · 第 ${lastScoreRound} 轮进行中`;
    if (done) return `连接已断开 · 已打完 ${done} 轮`;
    return "连接已断开 · 本场积分";
  }
  if (inPlay && lastScoreRound) return `上次对局 · 第 ${lastScoreRound} 轮进行中`;
  if (done) return `上次对局 · ${done} 轮`;
  return "上次对局积分";
}

function renderSavedMatch(reason: "disconnect" | "review"): void {
  const snap = readOnlineMatch();
  if (!lastScorePlayers.length && snap) adoptOnlineMatch(snap);
  if (!lastScorePlayers.length && snap?.players)
    lastScorePlayers = snap.players.map((p) => ({ ...p }));
  const players = lastScorePlayers;
  const mySeat = lastScoreMySeat;
  if (!players.length) return;
  matchDetached = true;
  $("result")
    .querySelector(".result-panel")
    ?.classList.add("is-final");
  const title = $("result").querySelector(".title") as HTMLElement;
  const n = matchRoundNets.length || lastScoreRound;
  title.textContent = savedMatchTitle(reason);
  showRoomCode("result-code", lastScoreCode);
  const dots = $("result-dots");
  if (dots) {
    dots.innerHTML = n
      ? Array.from({ length: n }, (_, i) =>
          `<span class="dot${i === n - 1 ? " on" : ""}"></span>`
        ).join("")
      : `<span class="dot on"></span>`;
  }
  $("result-list").innerHTML = scoreBoardHtml(players, mySeat, {
    livePoints: lastLivePoints.some((x) => x) ? lastLivePoints : undefined,
  });
  const btnAgain = $<HTMLButtonElement>("btn-again");
  const btnExit = $<HTMLButtonElement>("btn-exit");
  const btnSettle = $<HTMLButtonElement>("btn-result-settle");
  btnSettle.classList.add("hidden");
  btnExit.style.display = "";
  btnExit.textContent = "返回大厅";
  if (lastScoreCode) {
    btnAgain.classList.remove("hidden");
    btnAgain.classList.add("primary");
    btnAgain.textContent = "用此房号续开";
  } else {
    btnAgain.classList.add("hidden");
  }
  setMenuVisible(false);
  $("btn-help").classList.add("hidden");
  show("result");
}

function showRoomCode(id: string, code: string | undefined): void {
  const el = document.getElementById(id);
  if (!el) return;
  const c = String(code || "").trim();
  el.classList.toggle("hidden", !c);
  el.textContent = c ? `房号 ${c}` : "";
}

async function reopenSavedMatch(): Promise<void> {
  const snap = readOnlineMatch();
  if (!snap?.code) throw new Error("没有可续开的房号");
  matchDetached = false;
  stopOffline();
  try {
    await net.joinByCode(playerName(), snap.code);
    toast(`已加入房间 ${snap.code}`);
    return;
  } catch {
    /* 房间已关，下面按原房号重建 */
  }
  await net.create(
    playerName(),
    Math.max(2, snap.players.length),
    currentThemeId(),
    {
      preferredCode: snap.code,
      resumeSeat: snap.mySeat,
      resume: {
        round: snap.round,
        roundNets: snap.roundNets,
        players: snap.players,
      },
    }
  );
  toast(`已用房号 ${snap.code} 续开`);
}

function clearMatchRoundNets(): void {
  matchRoundNets = [];
}

function formatNet(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

function netClass(n: number): string {
  return n > 0 ? "win" : n < 0 ? "lose" : "";
}

function playerLabel(p: {
  name: string;
  isAi?: boolean;
}): string {
  const name = String(p.name ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const ai =
    p.isAi && !String(p.name).startsWith("机器人")
      ? '<span class="ai-tag">机</span>'
      : "";
  return `${name}${ai}`;
}

/** 优先用分轮净胜求和，避免 roundOver 早于 state 同步时累计滞后 */
function seatMatchTotal(seat: number, fallback: number): number {
  if (!matchRoundNets.length) return fallback;
  return matchRoundNets.reduce((s, row) => s + (row[seat] ?? 0), 0);
}

/** 玩家为列：累计总分 + 各轮净胜 */
function scoreBoardHtml(
  players: { seat: number; name: string; isAi?: boolean; totalNet: number }[],
  mySeat: number,
  opts?: {
    highlightRound?: number;
    livePoints?: number[];
    piles?: number[][];
  }
): string {
  const cols = [...players].sort((a, b) => a.seat - b.seat);
  const n = Math.max(2, cols.length);
  const style = `--score-n:${n}`;

  const head = cols
    .map(
      (p) =>
        `<div class="sc${p.seat === mySeat ? " me" : ""}">${playerLabel(
          p
        )}</div>`
    )
    .join("");

  const total = cols
    .map((p) => {
      const v = seatMatchTotal(p.seat, p.totalNet);
      return `<div class="sc net ${netClass(v)}${
        p.seat === mySeat ? " me" : ""
      }">${formatNet(v)}</div>`;
    })
    .join("");

  const live =
    opts?.livePoints && opts.livePoints.length
      ? `<div class="score-row live">
          <div class="sl">本轮</div>
          ${cols
            .map((p) => {
              const v = opts.livePoints![p.seat] ?? 0;
              return `<div class="sc${
                p.seat === mySeat ? " me" : ""
              }">${v}</div>`;
            })
            .join("")}
        </div>`
      : "";

  const rounds = matchRoundNets.length
    ? matchRoundNets
        .map((row, i) => {
          const on = opts?.highlightRound === i + 1 ? " on" : "";
          const cells = cols
            .map((p) => {
              const v = row[p.seat] ?? 0;
              return `<div class="sc net ${netClass(v)}${
                p.seat === mySeat ? " me" : ""
              }">${formatNet(v)}</div>`;
            })
            .join("");
          return `<div class="score-row${on}">
            <div class="sl">R${i + 1}</div>
            ${cells}
          </div>`;
        })
        .join("")
    : `<div class="score-empty">暂无轮次记录</div>`;

  const piles =
    opts?.piles && opts.piles.some((x) => x?.length)
      ? `<div class="score-row piles">
          <div class="sl">吃牌</div>
          ${cols
            .map((p) => {
              const pile = opts.piles![p.seat] ?? [];
              const chips = pile.length
                ? pile
                    .map((id) => {
                      const cls = isRed(id) ? "pile-card red" : "pile-card";
                      return `<span class="${cls}">${cardName(id)}</span>`;
                    })
                    .join("")
                : `<span class="pile-empty">—</span>`;
              return `<div class="sc pile${
                p.seat === mySeat ? " me" : ""
              }">${chips}</div>`;
            })
            .join("")}
        </div>`
      : "";

  return `<div class="score-board" style="${style}">
    <div class="score-row head">
      <div class="sl"></div>
      ${head}
    </div>
    <div class="score-row total">
      <div class="sl">累计</div>
      ${total}
    </div>
    ${rounds}
    ${live}
    ${piles}
  </div>`;
}

function queueRoundOver(r: RoundOver): void {
  rememberRoundNets(r);
  lastRound = r;
  persistOnlineMatch();
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
    await net.quickMatch(playerName(), maxPlayers, currentThemeId());
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
    await net.create(playerName(), maxPlayers, currentThemeId());
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
  $("btn-rules-ok").classList.remove("hidden");
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

function syncThemeFromState(state: { themeId?: string } | null | undefined): void {
  if (!state?.themeId) return;
  if (state.themeId === currentThemeId()) return;
  applyTheme(state.themeId);
  sfx.setTheme(state.themeId);
  paintAllThemeSegs(state.themeId);
  sfx.themeSwitch();
}

function paintThemeSeg(rootId: string, active: string): void {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.querySelectorAll("button[data-theme]").forEach((btn) => {
    const id = (btn as HTMLElement).dataset.theme ?? "";
    btn.classList.toggle("on", id === active);
  });
}

function paintAllThemeSegs(active: string): void {
  paintThemeSeg("lobby-theme-seg", active);
  paintThemeSeg("menu-theme-seg", active);
}

function setThemeLocalAndRemote(id: string, announce = true): void {
  const prev = currentThemeId();
  applyTheme(id);
  sfx.setTheme(id);
  paintAllThemeSegs(id);
  if (offline) offline.setTheme(id);
  else if (net.room && isHost()) net.setTheme(id);
  if (announce && id !== prev) {
    const name = THEMES[id as keyof typeof THEMES]?.name ?? id;
    toast(`主题：${name}`);
    sfx.themeSwitch();
  }
}

function bindThemeSeg(rootId: string, requireHost: boolean): void {
  const el = document.getElementById(rootId);
  if (!el) return;
  el.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-theme]");
    if (!btn) return;
    const id = (btn as HTMLElement).dataset.theme;
    if (!id) return;
    if (requireHost && !isHost()) return;
    setThemeLocalAndRemote(id, true);
  });
}
bindThemeSeg("lobby-theme-seg", false);
bindThemeSeg("menu-theme-seg", true);
paintAllThemeSegs(currentThemeId());

function setMenuVisible(v: boolean): void {
  $("btn-menu").classList.toggle("hidden", !v);
  if (v) setChatPanelOpen(false);
}

function openGameMenu(): void {
  const canSettle = isHost() && !lastRound?.allDone;
  $("btn-menu-settle").classList.toggle("hidden", !canSettle);
  const host = isHost();
  $("menu-theme").classList.toggle("hidden", !host);
  if (host) {
    const tid =
      offline?.state.themeId ?? net.state?.themeId ?? currentThemeId();
    paintAllThemeSegs(String(tid));
  }
  setChatPanelOpen(false);
  show("game-menu");
}

function renderScores(): void {
  const state = playState();
  if (!state) return;
  const players = [...state.players.values()] as any[];
  const mySeat = offline ? offline.mySeat : net.mySeat;
  $("scores-round").textContent = !state.round
    ? "尚未完成轮次"
    : state.phase === "PLAYING"
      ? `第 ${state.round} 轮进行中`
      : `已打 ${state.round} 轮`;
  showRoomCode("scores-code", offline ? "" : String(state.code || ""));
  const bySeat: number[] | undefined =
    state.phase === "PLAYING"
      ? (() => {
          const arr: number[] = [];
          for (const p of players) arr[p.seat] = Number(p.points) || 0;
          return arr;
        })()
      : undefined;
  $("scores-list").innerHTML = scoreBoardHtml(
    players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isAi: p.isAi,
      totalNet: p.totalNet,
    })),
    mySeat,
    { livePoints: bySeat }
  );
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
$("btn-resume-match").onclick = () => {
  guard(async () => {
    const ok = await net.tryResumeSeat(playerName());
    if (!ok) {
      toast("没有可回到的对局");
      await refreshResumeBtn();
      return;
    }
    toast("已回到未完成的对局");
  });
};
$("btn-last-match").onclick = () => {
  const snap = readOnlineMatch();
  if (snap) adoptOnlineMatch(snap);
  if (!lastScorePlayers.length) {
    toast("没有可查看的对局积分");
    return;
  }
  renderSavedMatch("review");
};

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
  const host = state.hostSessionId === net.room?.sessionId;
  $<HTMLButtonElement>("btn-ai").disabled =
    players.length >= state.maxPlayers || !host;
  syncThemeFromState(state);
}

// ---------- 结算 ----------

$("btn-again").onclick = () => {
  if (matchDetached) {
    void guard(reopenSavedMatch);
    return;
  }
  pendingRoundOver = null;
  if (offline) {
    if (lastRound?.allDone) {
      clearMatchRoundNets();
      offline.start();
    } else offline.continueRound();
    show("none");
    return;
  }
  if (lastRound?.allDone) clearMatchRoundNets();
  net.nextRound();
  if (lastRound && !lastRound.allDone) toast("已确认，等待其他玩家…");
  show("none");
};
$("btn-exit").onclick = () => {
  if (matchDetached) {
    matchDetached = false;
    net.abandonRecover();
    show("lobby");
    return;
  }
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
  const ranked = [...players].sort((a, b) => {
    const ta = seatMatchTotal(a.seat, a.totalNet as number);
    const tb = seatMatchTotal(b.seat, b.totalNet as number);
    return r.allDone
      ? tb - ta
      : (r.net[b.seat] ?? 0) - (r.net[a.seat] ?? 0);
  });

  $("result")
    .querySelector(".result-panel")
    ?.classList.toggle("is-final", !!r.allDone);

  const title = $("result").querySelector(".title") as HTMLElement;
  const winner = ranked[0];
  const winTotal = winner
    ? seatMatchTotal(winner.seat, winner.totalNet as number)
    : 0;
  const iWin =
    winner?.seat === mySeat &&
    (r.allDone ? winTotal >= 0 : (r.net[winner.seat] ?? 0) >= 0);
  title.textContent = r.allDone
    ? iWin
      ? "最终结算 · 胜"
      : `最终结算（${r.round} 轮）`
    : `第 ${r.round} 轮结算`;
  showRoomCode("result-code", offline ? "" : String(state.code || ""));

  const dots = $("result-dots");
  if (dots) {
    if (r.round > 0) {
      dots.innerHTML = Array.from({ length: r.round }, (_, i) => {
        const on = i === r.round - 1 || r.allDone ? " on" : "";
        return `<span class="dot${on}"></span>`;
      }).join("");
    } else {
      dots.innerHTML = `<span class="dot on"></span>`;
    }
  }

  const piles = !r.allDone
    ? players.reduce<number[][]>((acc, p) => {
        acc[p.seat] = [...(r.captured?.[p.seat] ?? [])];
        return acc;
      }, [])
    : undefined;

  $("result-list").innerHTML = scoreBoardHtml(
    players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isAi: p.isAi,
      totalNet: p.totalNet,
    })),
    mySeat,
    {
      highlightRound: r.allDone || r.base === 0 ? undefined : r.round,
      piles,
    }
  );

  const btnAgain = $<HTMLButtonElement>("btn-again");
  const btnExit = $<HTMLButtonElement>("btn-exit");
  const btnSettle = $<HTMLButtonElement>("btn-result-settle");
  matchDetached = false;
  btnAgain.classList.remove("hidden");
  btnExit.textContent = "返回大厅";
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

function lockPlay(): boolean {
  if (playLocked) return false;
  playLocked = true;
  playAwaitingAnim = true;
  playLockAt = performance.now();
  view.turnBlocked = true;
  return true;
}

function unlockPlay(): void {
  playLocked = false;
  playAwaitingAnim = false;
  playLockAt = 0;
}

function pickHand(id: number): void {
  const state = playState();
  if (
    playLocked ||
    !myTurn() ||
    !state ||
    state.turnPhase !== "PLAY_HAND" ||
    view.animating ||
    view.turnBlocked
  )
    return;
  const targets = findTargets(id, [...state.table]);
  const auto = autoTarget(targets);
  if (auto !== undefined) return send(id, auto);
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
  if (playLocked || !state || view.animating || view.turnBlocked) return;
  if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
    if (!myTurn()) return;
    if (view.targets.includes(id)) {
      if (!lockPlay()) return;
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
  if (!lockPlay()) return;
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
  unlockPlay();
  offline?.stop();
  offline = null;
  $("btn-chat-toggle").classList.add("hidden");
  clearChatLog();
  clearMatchRoundNets();
  setMenuVisible(false);
  handLookUntil = 0;
  view.turnBlocked = false;
  view.resetAnimVisuals();
  refreshPracticeBtn();
}

function refreshPracticeBtn(): void {
  const btn = $("btn-practice");
  if (!btn) return;
  btn.textContent = hasLocalSave() ? "继续人机练习" : "人机练习（可离线）";
}

function wireOfflineSession(session: LocalPlay): void {
  session.animBusy = () => view.animating || view.turnBlocked;
  session.onState = (state) => {
    syncThemeFromState(state);
    applyPlayState(state, session.hand, session.mySeat);
    if (state.phase === "PLAYING") {
      const overlay =
        shown("rules") ||
        shown("guide") ||
        shown("game-menu") ||
        shown("scores") ||
        shown("settle-confirm");
      if (!overlay) show("none");
      $("btn-chat-toggle").classList.toggle("hidden", overlay);
      if (overlay) setChatPanelOpen(false);
      $("btn-help").classList.toggle("hidden", overlay);
      setMenuVisible(!overlay);
      if (!overlay) refreshTurnHint();
    } else if (state.phase === "ROUND_OVER") {
      $("btn-chat-toggle").classList.remove("hidden");
      setChatPanelOpen(false);
      setMenuVisible(!lastRound?.allDone);
    }
    syncSelection();
  };
  session.onEvents = (events) => {
    view.pushEvents(events);
    adoptHand(session.hand);
    if (pendingRoundOver && view.settleBusy)
      roundOverWaitStarted = performance.now();
    for (const ev of events) {
      if (ev.target === undefined) sfx.discard();
    }
  };
  session.onRoundStart = () => {
    onDealRoundStart();
    adoptHand(session.hand);
    if (localStorage.getItem("jhd.guided") !== "1") show("guide");
    else show("none");
  };
  session.onRoundOver = (r) => {
    if (r.allDone) refreshPracticeBtn();
    queueRoundOver(r);
  };
}

function startOffline(): void {
  stopOffline();
  clearChatLog();
  void net.leave().catch(() => undefined);
  const resumed = LocalPlay.tryResume(playerName());
  const session = resumed ?? new LocalPlay(playerName(), maxPlayers);
  offline = session;
  wireOfflineSession(session);
  if (resumed) {
    maxPlayers = session.state.maxPlayers;
    Array.from($("counts").children).forEach((b) =>
      b.classList.toggle(
        "on",
        Number((b as HTMLElement).dataset.n) === maxPlayers
      )
    );
    matchRoundNets = session.exportRoundNets();
    lastDealRound = session.state.round;
    dealRoundPending = false;
    pendingRoundOver = null;
    handLookUntil = 0;
    view.resetAnimVisuals();
    view.turnBlocked = false;
    session.bootstrapAfterResume();
    toast(`继续人机练习 · ${maxPlayers} 人`);
    refreshPracticeBtn();
    return;
  }
  session.setTheme(currentThemeId());
  session.start();
  toast(`人机练习（离线）· ${maxPlayers} 人`);
  refreshPracticeBtn();
}

// ---------- 网络回调 ----------

net.onState = (state) => {
  if (offline) return;
  syncThemeFromState(state);
  applyPlayState(state, net.hand, net.mySeat);

  if (state.phase === "WAITING") {
    if (!state.round) clearMatchRoundNets();
    renderRoom(state);
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
    $("btn-chat-toggle").classList.toggle("hidden", overlay);
    if (overlay) setChatPanelOpen(false);
    $("btn-help").classList.toggle("hidden", overlay);
    setMenuVisible(!overlay && !net.spectating);
    if (!overlay) refreshTurnHint();
  } else if (state.phase === "ROUND_OVER") {
    $("btn-chat-toggle").classList.remove("hidden");
    setChatPanelOpen(false);
    $("btn-help").classList.toggle("hidden", net.spectating);
    setMenuVisible(!net.spectating && !lastRound?.allDone);
  }
  syncSelection();
};

net.onRoundStart = () => {
  onDealRoundStart();
  adoptHand(net.hand);
  ensureDealAnimForRound();
  if (localStorage.getItem("jhd.guided") !== "1") {
    show("guide");
  } else {
    show("none");
  }
};

net.onHand = () => {
  if (offline) return;
  adoptHand(net.hand);
  if (dealRoundPending) view.syncDealHidden();
  tryStartDealAnim();
};

net.onEvents = (events) => {
  if (offline) return;
  view.pushEvents(events);
  adoptHand(net.hand);
  if (pendingRoundOver && view.settleBusy)
    roundOverWaitStarted = performance.now();
  for (const ev of events) {
    if (ev.target === undefined) sfx.discard();
  }
};

net.onRoundOver = (r) => {
  if (offline) return;
  queueRoundOver(r);
};

const EMOTE_ITEMS: Array<{ id: string; icon: string }> = [
  { id: "加油", icon: "💪" },
  { id: "好牌", icon: "👏" },
  { id: "厉害", icon: "👍" },
  { id: "等等", icon: "⏳" },
  { id: "哈哈哈", icon: "😄" },
  { id: "谢谢", icon: "🙏" },
  { id: "倒霉", icon: "😅" },
  { id: "再来", icon: "🔥" },
];
const EMOTE_ICON: Record<string, string> = Object.fromEntries(
  EMOTE_ITEMS.map((e) => [e.id, e.icon])
);
const QUICK_PHRASES = [
  "拜托给口好牌",
  "这波稳了",
  "小心红点",
  "我先弃一手",
  "等等我思考下",
  "打得漂亮",
  "别急，看牌",
  "这牌太闷了",
  "下一轮继续",
  "友谊第一",
];
const EMOTE_COOLDOWN_MS = 1200;
const CHAT_COOLDOWN_MS = 1200;
let lastEmoteAt = 0;
let lastChatAt = 0;
let emoteTimer = 0;
let socialTab: "speak" | "log" = "speak";

// ---------- 聊天 / 表情 ----------
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

function fillSocialLists(): void {
  const emojiRow = $("emoji-row");
  emojiRow.innerHTML = EMOTE_ITEMS.map(
    (e) =>
      `<button type="button" data-e="${e.id}" title="${e.id}"><span class="emoji-ico">${e.icon}</span><span class="emoji-lab">${e.id}</span></button>`
  ).join("");
  const phrases = $("phrase-list");
  phrases.innerHTML = QUICK_PHRASES.map(
    (t) => `<button type="button" data-phrase="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join("");
}

function clearChatLog(): void {
  chatLog.length = 0;
  chatUnread = 0;
  renderChatLog();
  updateChatBadge();
  $("social-panel").classList.add("hidden");
}

function isChatOpen(): boolean {
  return !$("social-panel").classList.contains("hidden");
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
  if (!chatLog.length) {
    log.innerHTML = `<div class="chat-empty">暂无聊天记录</div>`;
    return;
  }
  log.innerHTML = chatLog
    .map((e) => {
      const icon = e.isEmote ? EMOTE_ICON[e.text] ?? "💬" : "";
      const cls = `chat-msg${e.mine ? " chat-mine" : ""}`;
      const text = e.isEmote
        ? `<span class="chat-emote">${icon} ${escapeHtml(e.text)}</span>`
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

function setSocialTab(tab: "speak" | "log"): void {
  socialTab = tab;
  $("social-tab-speak").classList.toggle("hidden", tab !== "speak");
  $("social-tab-log").classList.toggle("hidden", tab !== "log");
  $("tab-speak").classList.toggle("on", tab === "speak");
  $("tab-log").classList.toggle("on", tab === "log");
  if (tab === "log") renderChatLog();
}

function setChatPanelOpen(open: boolean): void {
  $("social-panel").classList.toggle("hidden", !open);
  if (open) {
    chatUnread = 0;
    updateChatBadge();
    setSocialTab(socialTab);
    if (socialTab === "log") renderChatLog();
  }
}

function toggleChatPanel(): void {
  const opening = !isChatOpen();
  if (opening && chatUnread > 0) socialTab = "log";
  else if (opening) socialTab = "speak";
  setChatPanelOpen(opening);
}

function sendChatText(raw: string): void {
  const text = raw.trim().slice(0, 200);
  if (!text) return;
  const now = Date.now();
  if (now - lastChatAt < CHAT_COOLDOWN_MS) {
    toast("发送太快了");
    return;
  }
  if (offline) {
    lastChatAt = now;
    setChatPanelOpen(false);
    addChatEntry({
      seat: offline.mySeat,
      name: playerName(),
      text,
      isEmote: false,
      mine: true,
    });
    showSocialFlash(playerName(), text, false);
    return;
  }
  if (!net.room) {
    toast("未连接房间");
    return;
  }
  lastChatAt = now;
  setChatPanelOpen(false);
  net.chat(text);
}

function sendChat(): void {
  const input = $("chat-input") as HTMLInputElement;
  const text = input.value;
  if (!text.trim()) return;
  input.value = "";
  sendChatText(text);
}

$("btn-chat-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleChatPanel();
});
$("btn-social-close").addEventListener("click", () => setChatPanelOpen(false));
$("btn-chat-send").addEventListener("click", sendChat);
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChat();
  }
});
$("tab-speak").addEventListener("click", () => setSocialTab("speak"));
$("tab-log").addEventListener("click", () => setSocialTab("log"));
$("emoji-row").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const id = (btn as HTMLButtonElement).dataset.e;
  if (id) sendEmote(id);
});
$("phrase-list").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  const text = (btn as HTMLButtonElement).dataset.phrase;
  if (text) sendChatText(text);
});
const phraseScroll = document.querySelector(".phrase-scroll");
if (phraseScroll) {
  phraseScroll.addEventListener(
    "touchmove",
    (e) => e.stopPropagation(),
    { passive: true }
  );
  phraseScroll.addEventListener("wheel", (e) => e.stopPropagation(), {
    passive: true,
  });
}

/** 居中提示：自己与他人都能看到本条消息 */
function showSocialFlash(name: string, text: string, isEmote: boolean): void {
  const el = $("emote-bubble");
  const icon = isEmote ? EMOTE_ICON[text] ?? "💬" : "💬";
  el.textContent = isEmote
    ? `${icon} ${name}：${text}`
    : `${icon} ${name}：${text}`;
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
    setChatPanelOpen(false);
    addChatEntry({
      seat: offline.mySeat,
      name: playerName(),
      text: id,
      isEmote: true,
      mine: true,
    });
    showSocialFlash(playerName(), id, true);
    return;
  }
  if (!net.room) {
    toast("未连接房间");
    return;
  }
  setChatPanelOpen(false);
  net.emote(id);
}

fillSocialLists();

net.onEmote = (e) => {
  showSocialFlash(e.name, e.id, true);
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
  showSocialFlash(e.name, e.text, false);
  const mine = e.seat === (offline?.mySeat ?? net.mySeat);
  addChatEntry({
    seat: e.seat,
    name: e.name,
    text: e.text,
    isEmote: false,
    mine,
  });
};

net.onMatchHistory = (m) => {
  if (!m?.roundNets?.length) return;
  matchRoundNets = m.roundNets.map((row) => [...row]);
  if (m.round) lastScoreRound = m.round;
  persistOnlineMatch();
};

net.onError = (msg) => {
  toast(msg);
  unlockPlay();
  selected = -1;
  discardArmed = -1;
  syncSelection();
};

net.onDropped = () => {
  persistOnlineMatch();
  toast("连接断开，正在重连…", 8000);
};

net.onRecoverHold = () => {
  persistOnlineMatch();
  if (hasOnlineMatchSave() || lastScorePlayers.length || matchRoundNets.length) {
    renderSavedMatch("disconnect");
    toast("仍在尝试重连，可先查看本场积分", 5000);
  }
};

net.onReconnected = () => {
  matchDetached = false;
  toast("已重新连上");
};

net.onLeave = (consented) => {
  unlockPlay();
  clearChatLog();
  $("btn-chat-toggle").classList.add("hidden");
  if (offline) return;
  persistOnlineMatch();
  if (consented) {
    refreshLastMatchBtn();
    void refreshResumeBtn();
    if (lastRound) return;
    show("lobby");
    return;
  }
  if (hasOnlineMatchSave() || lastScorePlayers.length || matchRoundNets.length) {
    renderSavedMatch("disconnect");
    toast("无法重连，本场积分已保存在本机", 4000);
    return;
  }
  toast("已断开连接");
  show("lobby");
};

// 刷新页面后尝试回到原对局（纯静态托管时会静默失败）
refreshLastMatchBtn();
if (!import.meta.env.VITE_OFFLINE_ONLY)
  net.tryResumeSeat(playerName()).then((ok) => {
    if (ok) toast("已回到未完成的对局");
    refreshLastMatchBtn();
    void refreshResumeBtn();
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
  const dt = Math.min(0.12, (now - last) / 1000);
  last = now;
  if ($("ui").classList.contains("rot") !== shouldRotate()) applyOrientation();
  try {
    if (!view.handDragging) adoptHand(offline ? offline.hand : net.hand);
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

window.addEventListener("pagehide", () => {
  offline?.flushSave();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") offline?.flushSave();
});
