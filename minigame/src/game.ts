/**
 * 小游戏入口：界面切换与出牌交互（离线人机 + 联机）。
 * 出牌锁 / 发牌动画 / 结算等待的时序与 Web 端 main.ts 一致。
 * 交互约定：点手牌 → 唯一目标直接吃；多目标高亮待选；无目标需再点一次确认弃牌。
 */
import { bootFailed, canvas, sys } from "./boot";
import {
  autoTarget,
  cardName,
  dealOpenMs,
  findTargets,
  isRed,
  turnHint,
  THEMES,
  THEME_IDS,
  type ThemeId,
  ROUND_RESULT_MAX_WAIT_MS,
  ROUND_END_EVENT_GRACE_MS,
  TURN_UI_LOCK_MS,
} from "@jhd/shared";
import {
  api,
  exitGame,
  loadImage,
  onInviteCode,
  platformName,
  promptText,
  setupShare,
  share,
  storage,
  type MiniTouchEvent,
  type ShareOpts,
} from "./platform";
import {
  isPrivacyError,
  openPrivacyContract,
  platformNickLabel,
  privacyContractName,
  requestNickname,
  requirePrivacy,
  setupPrivacyPopup,
  silentNickname,
  syncNickButton,
  useNativeNickButton,
} from "./platform/profile";
import { inviteCard, resultCard } from "./shareCard";
import { sfx } from "./audio";
import { loadCardAtlas } from "./cardRender";
import { LocalPlay, hasLocalSave } from "./localPlay";
import { Net, deviceId, hasRemoteWs, wsEndpoint, type Profile, type RoundOver } from "./net";
import { TableView } from "./table";
import { UI, applyTheme, currentThemeId, loadSavedTheme } from "./theme";
import { loadThemeArt } from "./themeArt";
import { Overlay, alpha, type BtnSpec } from "./ui";
import {
  EMOTES,
  QUICK_PHRASES,
  drawCodePad,
  drawDialog,
  drawEmotes,
  drawGuide,
  drawLobby,
  drawAgeHint,
  drawNickPrompt,
  drawPrivacy,
  drawRank,
  drawRules,
  drawMenu,
  drawResult,
  drawRoom,
  drawScores,
  type Board,
  type Dialog,
  type ThemeCard,
  type SeatView,
} from "./screens";

applyTheme(loadSavedTheme());
void loadCardAtlas();
void loadThemeArt();

const now = () => Date.now();

type Screen =
  | "lobby"
  | "code"
  | "room"
  | "result"
  | "menu"
  | "scores"
  | "emote"
  | "guide"
  | "rules"
  | "rank"
  | "nick"
  | "none";
/** 对局中弹出的浮层：状态推进时不被切回牌桌 */
const IN_GAME_LAYERS: Screen[] = ["menu", "scores", "emote", "guide", "rules"];
let rulesBack: Screen = "lobby";
let screen: Screen = "lobby";
const net = new Net();
net.onProgress = (msg) => toast(msg, 5000);
/** 离线人机会话；有值时走本地规则，不连服务器 */
let offline: LocalPlay | null = null;
let maxPlayers = 4;
let selected = -1;
/** 无目标的牌需二次点击确认弃牌，避免误操作 */
let discardArmed = -1;
let lastRound: RoundOver | null = null;
/** 本场各轮净胜分：matchRoundNets[roundIndex][seat] */
let matchRoundNets: number[][] = [];
let wasMyTurn = false;
/** 刚切到自己回合、事件动画尚未入队时的短锁截止时间 */
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
/** 发牌+看牌结束时刻（此前禁止出手） */
let handLookUntil = 0;
let hintText: string | null = null;
let toastText = "";
let toastUntil = 0;
let codeMode: "join" | "spectate" = "join";
let codeInput = "";
let busy = false;
let resumeAvailable = false;

const view = new TableView(canvas, {
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
sfx.setTheme(currentThemeId());

function syncTheme(id: string | undefined): void {
  if (!id || id === currentThemeId()) return;
  applyTheme(id);
  sfx.setTheme(id);
  sfx.themeSwitch();
}

function onEventsSfx(events: { target?: number }[]): void {
  for (const ev of events) if (ev.target === undefined) sfx.discard();
}

/** 本机切主题；对局中由房主同步给房间 */
function setThemeLocalAndRemote(id: ThemeId): void {
  if (id === currentThemeId()) return;
  applyTheme(id);
  sfx.setTheme(id);
  if (offline) offline.setTheme(id);
  else if (net.room && isHost()) net.setTheme(id);
  toast(`主题：${THEMES[id].name}`);
  sfx.themeSwitch();
}

function openRules(): void {
  rulesBack = screen;
  screen = "rules";
}

let rankRows: Profile[] = [];
let rankLoading = false;

function openRank(): void {
  screen = "rank";
  rankRows = [];
  rankLoading = true;
  net
    .leaderboard()
    .then((rows) => (rankRows = rows))
    .catch((e: Error) => toast(e.message || "排行榜获取失败"))
    .finally(() => (rankLoading = false));
}

async function editName(): Promise<void> {
  const raw = await promptText(storage.get("jhd.name") ?? "", 10);
  if (raw === null) return toast("当前平台不支持输入");
  const name = raw.trim().slice(0, 10);
  storage.set("jhd.name", name);
  toast(name ? `昵称已改为 ${name}` : "已恢复默认昵称");
  if (name && screen === "nick") screen = "lobby";
}

/** 平台授权拿到的昵称：填入后仍可点输入框手动修改 */
function applyPlatformNick(name: string | null, errMsg = ""): void {
  if (!name) {
    if (isPrivacyError(errMsg))
      return void requirePrivacy().then((ok) =>
        toast(ok ? "已同意隐私协议，请再点一次获取昵称" : "未同意隐私协议，可手动填写昵称", 3000)
      );
    return toast(`未获取到昵称（${errMsg || "已取消"}），可手动填写`, 3000);
  }
  const v = name.slice(0, 10);
  storage.set("jhd.name", v);
  toast(`已填入昵称：${v}`);
  if (screen === "nick") screen = "lobby";
}

/** 画布上的昵称按钮：微信由原生透明按钮接管点击，这里只处理抖音 / 不支持的环境 */
function onNickTap(): void {
  if (useNativeNickButton) return;
  if (platformName !== "douyin") return toast("当前环境不支持获取昵称，可手动填写");
  void requestNickname().then((n) => applyPlatformNick(n, n ? "" : "抖音授权未通过"));
}

/** 待用户回应的隐私授权（非空时全屏展示隐私页，盖在所有界面之上） */
let privacyPending: ((agree: boolean) => void)[] = [];
/** 适龄提示说明面板（大厅 / 隐私页的适龄标记点开） */
let ageOpen = false;
let privacyName = "《用户隐私保护指引》";

setupPrivacyPopup((answer) => {
  privacyPending.push(answer);
  void privacyContractName().then((n) => (privacyName = n));
});

/** 同意：放行所有等待中的隐私接口；不同意：退出小游戏（平台不支持退出时仅提示） */
function answerPrivacy(agree: boolean): void {
  const pending = privacyPending;
  privacyPending = [];
  pending.forEach((answer) => answer(agree));
  if (agree) return;
  if (!exitGame()) toast("未同意隐私协议，昵称请手动填写", 3500);
}

/** 首次进入且没有昵称：弹引导，并先拉起微信隐私协议，避免点授权按钮时 104 失败 */
function askNicknameOnce(): void {
  if (storage.get("jhd.name") || storage.get("jhd.nickAsked") || screen !== "lobby") return;
  storage.set("jhd.nickAsked", "1");
  screen = "nick";
  void requirePrivacy();
}

/** 首次开局弹新手引导，其后直接进牌桌 */
function roundStartScreen(): Screen {
  return storage.get("jhd.guided") === "1" ? "none" : "guide";
}
const overlay = new Overlay(canvas.getContext("2d"), sys);

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

function toast(msg: string, ms = 2200): void {
  toastText = msg;
  toastUntil = now() + ms;
}

function hint(msg: string | null): void {
  hintText = msg;
}

function playerName(): string {
  return storage.get("jhd.name") || "无名客";
}

async function guard(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    const msg = (e as Error).message || "连接失败";
    const offlineHint = hasRemoteWs()
      ? "连接失败，服务器可能在休眠，请稍后重试或先用人机练习"
      : `连不上服务器 ${wsEndpoint()}，请确认服务端已启动`;
    toast(/request:fail|network|failed|ECONN|timeout|abort/i.test(msg) ? offlineHint : msg, 4000);
  } finally {
    busy = false;
  }
}

// ---------- 回合节奏 ----------

function spectating(): boolean {
  return !offline && net.spectating;
}

function mySeatNow(): number {
  return offline ? offline.mySeat : net.mySeat;
}

function isHost(): boolean {
  if (offline) return true;
  if (!net.room || !net.state) return false;
  return net.state.hostSessionId === net.room.sessionId;
}

/** 按阶段整理回合提示，避免翻牌/结算动画误报「对手出牌中」 */
function refreshTurnHint(): void {
  const state = playState();
  if (!state || state.phase !== "PLAYING" || screen !== "none") return;

  const mine = myTurn();
  const t = now();

  if (mine && !wasMyTurn && !view.animating && turnUiLockUntil === 0)
    turnUiLockUntil = t + TURN_UI_LOCK_MS;
  if (view.animating) turnUiLockUntil = 0;
  if (turnUiLockUntil > 0 && t >= turnUiLockUntil) turnUiLockUntil = 0;

  const looking = t < handLookUntil;
  if (playLocked && view.animating) playAwaitingAnim = false;
  if (playLocked && !view.animating && !looking) {
    if (
      !playAwaitingAnim &&
      (!mine || state.turnPhase === "CHOOSE_STOCK_TARGET")
    )
      unlockPlay();
    else if (t - playLockAt > PLAY_LOCK_FALLBACK_MS) unlockPlay();
  }
  const busyNow = view.animating || t < turnUiLockUntil || looking || playLocked;
  view.turnBlocked = busyNow;

  if (looking && !view.animating) {
    const left = Math.max(1, Math.ceil((handLookUntil - t) / 1000));
    hint(`看牌中 · ${left}s 后开局`);
    wasMyTurn = false;
    return;
  }

  const text = turnHint({
    spectating: spectating(),
    offline: !!offline,
    myTurn: mine,
    turnPhase: state.turnPhase,
    busy: busyNow,
    pickingTable: selected >= 0 && discardArmed < 0,
    discardConfirm: discardArmed >= 0,
  });
  const myTurnNow = !spectating() && mine && !busyNow;
  if (myTurnNow && !wasMyTurn) sfx.turn();
  wasMyTurn = myTurnNow;
  hint(text);
}

/** 动画结束后展示结算；超时强制弹出 */
function flushRoundOverIfReady(): boolean {
  if (!pendingRoundOver) return false;
  const waited = now() - roundOverWaitStarted;
  if (waited < ROUND_END_EVENT_GRACE_MS) return false;
  if (view.settleBusy && waited < ROUND_RESULT_MAX_WAIT_MS) return false;
  pendingRoundOver = null;
  view.roundEnding = false;
  hint(null);
  sfx.roundOver();
  screen = "result";
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
  handLookUntil = now() + dealOpenMs(n);
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
  toastUntil = 0;
  hint(null);
}

function applyPlayState(state: any, hand: number[], mySeat: number): void {
  const prev = view.state;
  view.deferStateArrivals(prev, state);
  view.state = state;
  adoptHand(hand);
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

function rememberRoundNets(r: RoundOver): void {
  if (r.roundNets?.length) {
    matchRoundNets = r.roundNets.map((row) => [...row]);
    return;
  }
  // 纯结算收场（无本轮对局数据）不追加
  if (r.allDone && r.base === 0) return;
  if (r.round > 0) {
    matchRoundNets[r.round - 1] = [...r.net];
    matchRoundNets.length = r.round;
  }
}

function seatMatchTotal(seat: number, fallback: number): number {
  if (!matchRoundNets.length) return fallback;
  return matchRoundNets.reduce((s, row) => s + (row[seat] ?? 0), 0);
}

function queueRoundOver(r: RoundOver): void {
  rememberRoundNets(r);
  lastRound = r;
  pendingRoundOver = r;
  roundOverWaitStarted = now();
  view.roundEnding = true;
}

/** 离开一局（离线或联机）后清掉牌桌与本场记录 */
function resetTable(): void {
  unlockPlay();
  matchRoundNets = [];
  lastRound = null;
  pendingRoundOver = null;
  dealRoundPending = false;
  lastDealRound = 0;
  handLookUntil = 0;
  selected = -1;
  discardArmed = -1;
  hint(null);
  view.turnBlocked = false;
  view.resetAnimVisuals();
  view.state = null;
  view.hand = [];
}

// ---------- 出牌交互 ----------

function playState(): any {
  return offline?.state ?? net.state ?? null;
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
  playLockAt = now();
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
  toastUntil = 0;
  syncSelection();
  hint(null);
}

/** 同步选中态与可吃目标高亮 */
function syncSelection(): void {
  view.selected = selected;
  view.discardArmed = discardArmed;
  const state = playState();
  if (!state || view.animating || view.turnBlocked) {
    view.targets = [];
    return;
  }
  if (state.turnPhase === "CHOOSE_STOCK_TARGET" && state.currentSeat === mySeatNow())
    view.targets = findTargets(state.pendingStockCard, [...state.table]);
  else if (selected >= 0) view.targets = findTargets(selected, [...state.table]);
  else view.targets = [];
}

// ---------- 离线会话 ----------

function stopOffline(): void {
  offline?.stop();
  offline = null;
  resetTable();
}

function wireOfflineSession(session: LocalPlay): void {
  session.animBusy = () => view.animating || view.turnBlocked;
  session.onState = (state) => {
    syncTheme(state.themeId);
    applyPlayState(state, session.hand, session.mySeat);
    if (state.phase === "PLAYING" && !IN_GAME_LAYERS.includes(screen)) {
      screen = "none";
      refreshTurnHint();
    }
    syncSelection();
  };
  session.onEvents = (events) => {
    view.pushEvents(events);
    onEventsSfx(events);
    adoptHand(session.hand);
    if (pendingRoundOver && view.settleBusy) roundOverWaitStarted = now();
  };
  session.onRoundStart = () => {
    onDealRoundStart();
    adoptHand(session.hand);
    screen = roundStartScreen();
  };
  session.onRoundOver = (r) => queueRoundOver(r);
}

function startOffline(): void {
  stopOffline();
  void net.leave().catch(() => undefined);
  const resumed = LocalPlay.tryResume(playerName());
  const session = resumed ?? new LocalPlay(playerName(), maxPlayers);
  offline = session;
  wireOfflineSession(session);
  screen = "none";
  if (resumed) {
    maxPlayers = session.state.maxPlayers;
    matchRoundNets = session.exportRoundNets();
    lastDealRound = session.state.round;
    session.bootstrapAfterResume();
    toast(`继续人机练习 · ${maxPlayers} 人`);
    return;
  }
  session.setTheme(currentThemeId());
  session.start();
  toast(`人机练习 · ${maxPlayers} 人`);
}

// ---------- 联机 ----------

function enterOnline(fn: () => Promise<void>, next: Screen): void {
  void guard(async () => {
    stopOffline();
    await fn();
    screen = next;
  });
}

function openCodePad(mode: "join" | "spectate"): void {
  codeMode = mode;
  codeInput = "";
  screen = "code";
}

function submitCode(): void {
  const code = codeInput;
  if (code.length !== 6) return toast("请输入 6 位房号");
  if (codeMode === "join") enterOnline(() => net.joinByCode(playerName(), code), "room");
  else
    enterOnline(async () => {
      await net.spectateByCode(playerName(), code);
      toast("已进入观战");
    }, "none");
}

async function leaveOnline(): Promise<void> {
  await net.leave();
  resetTable();
  goLobby();
}

/** 回大厅，并查询本设备有无可回到的联机对局 */
function goLobby(): void {
  screen = "lobby";
  resumeAvailable = false;
  if (offline || net.room) return;
  void net.activeMatch().then((hit) => (resumeAvailable = !!hit && !net.room));
}

function resumeOnline(): void {
  void guard(async () => {
    stopOffline();
    if (await net.tryResumeSeat(playerName())) toast("已回到未完成的对局");
    else {
      toast("没有可回到的对局");
      goLobby();
    }
  });
}

function joinInvite(code: string): void {
  if (net.state?.code === code) return;
  toast(`正在加入房间 ${code}…`);
  enterOnline(() => net.joinByCode(playerName(), code), "room");
}

/** 切回前台：连接已断且未在自动重连时，尝试回到原座位 */
function onForeground(): void {
  offline?.flushSave();
  if (offline || net.room || net.recovering || busy) return;
  void guard(async () => {
    if (await net.tryResumeSeat(playerName())) toast("已回到未完成的对局");
  });
}

function listRoomPlayers(state: any) {
  const out: { sessionId: string; name: string; seat: number; isAi: boolean; ready: boolean; connected: boolean }[] = [];
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
      connected: p.connected !== false,
    });
  });
  return out.sort((a, b) => a.seat - b.seat);
}

function onSeatTap(seat: number): void {
  const state = net.state;
  if (!net.room || net.spectating || !state || state.phase !== "WAITING") return;
  const me = state.players.get(net.room.sessionId);
  if (!me || me.seat === seat) return;
  const occ = listRoomPlayers(state).find((p) => p.seat === seat);
  if (!occ || occ.isAi || occ.sessionId.startsWith("hold:") || !occ.connected) {
    net.sit(seat);
    return;
  }
  net.swapAsk(seat);
  toast(`已向 ${occ.name} 申请换座`);
}

function roomView(state: any): { seats: SeatView[]; status: string } {
  const players = listRoomPlayers(state);
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const nameCount = new Map<string, number>();
  for (const p of players) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);
  const canPick = state.phase === "WAITING" && !net.spectating && !!net.room;
  const seats: SeatView[] = [];
  for (let i = 0; i < state.maxPlayers; i++) {
    const p = bySeat.get(i);
    const mine = !!p && p.sessionId === net.room?.sessionId;
    const act = canPick ? { onTap: () => onSeatTap(i), disabled: mine } : undefined;
    if (!p) {
      seats.push({ label: `座位 ${i + 1} · 空`, ai: false, tag: "", mine: false, empty: true, act });
      continue;
    }
    const dup = (nameCount.get(p.name) ?? 0) > 1;
    seats.push({
      label: `${dup ? `${p.name}·座${i + 1}` : p.name}${mine ? "（我）" : ""}`,
      ai: p.isAi && !p.name.startsWith("机器人"),
      tag: p.sessionId.startsWith("hold:") ? "待归座" : p.ready ? "已准备" : "等待中",
      mine,
      empty: false,
      act,
    });
  }
  const need = state.maxPlayers - players.length;
  const unready = players.filter((p) => !p.ready).length;
  let status =
    need > 0
      ? `还差 ${need} 人（可点「添加机器人」补位）`
      : unready > 0
        ? `人数已满 · 还有 ${unready} 人未准备`
        : "全员已准备 · 即将开局";
  if (canPick) status += " · 点座位旁按钮换座";
  return { seats, status };
}

function wireNet(): void {
  net.onState = (state) => {
    if (offline) return;
    syncTheme(state.themeId);
    applyPlayState(state, net.hand, net.mySeat);
    if (state.phase === "WAITING") {
      if (!state.round) matchRoundNets = [];
      if (screen !== "result") screen = "room";
    } else if (state.phase === "PLAYING") {
      if (!IN_GAME_LAYERS.includes(screen)) screen = "none";
      refreshTurnHint();
    }
    syncSelection();
  };
  net.onRoundStart = () => {
    onDealRoundStart();
    adoptHand(net.hand);
    ensureDealAnimForRound();
    screen = roundStartScreen();
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
    onEventsSfx(events);
    adoptHand(net.hand);
    if (pendingRoundOver && view.settleBusy) roundOverWaitStarted = now();
  };
  net.onRoundOver = (r) => {
    if (offline) return;
    queueRoundOver(r);
  };
  net.onMatchHistory = (m) => {
    if (m?.roundNets?.length) matchRoundNets = m.roundNets.map((row) => [...row]);
  };
  net.onSwapAsk = (m) => {
    void ask("换座", `${m.fromName} 想和你对换座位（对方座位 ${m.fromSeat + 1}）`, "同意", "拒绝").then(
      (ok) => net.swapReply(ok)
    );
  };
  net.onSwapCancel = () => toast("换座申请已取消");
  net.onEmote = (e) => showBubble(e.name, e.id, true);
  net.onChat = (e) => {
    if (QUICK_PHRASES.includes(e.text)) showBubble(e.name, e.text, false);
  };
  net.onError = (msg) => {
    toast(msg);
    unlockPlay();
    selected = -1;
    discardArmed = -1;
    syncSelection();
  };
  net.onDropped = () => toast("连接断开，正在重连…", 8000);
  net.onRecoverHold = () => toast("仍在尝试重连…", 5000);
  net.onReconnected = () => toast("已重新连上");
  net.onLeave = (consented) => {
    unlockPlay();
    if (offline || consented) return;
    toast("已断开连接");
    resetTable();
    goLobby();
  };
}
wireNet();

// ---------- 分享 ----------

/** 开局前邀请：带房号，好友点开卡片直接入座 */
function inviteShare(): ShareOpts {
  const state = net.state;
  const code = String(state?.code ?? "");
  const seated = state ? listRoomPlayers(state).length : 1;
  return {
    title: `来捡红点，房号 ${code}，点开直接入座`,
    query: `room=${code}`,
    imageUrl: inviteCard({ code, seated, max: state?.maxPlayers ?? maxPlayers, host: playerName() }),
  };
}

/** 联机终局战绩 */
function resultShare(): ShareOpts {
  const state = playState();
  const mySeat = mySeatNow();
  const rows = ([...(state?.players.values() ?? [])] as any[])
    .map((p) => ({
      name: String(p.name || "玩家"),
      total: seatMatchTotal(p.seat, Number(p.totalNet) || 0),
      me: p.seat === mySeat,
    }))
    .sort((a, b) => b.total - a.total);
  const rank = rows.findIndex((r) => r.me) + 1;
  const me = rows[rank - 1];
  const round = lastRound?.round ?? state?.round ?? 0;
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  const title = me
    ? `捡红点战绩：${me.name} ${sign(me.total)}，第 ${rank}/${rows.length} 名（${round} 轮）`
    : `捡红点战绩：${rows[0]?.name ?? ""} 夺冠 ${sign(rows[0]?.total ?? 0)}（${round} 轮）`;
  return { title, imageUrl: resultCard({ title: `最终结算（${round} 轮）`, rows }) };
}

function onlineFinal(): boolean {
  return !offline && !!net.room && screen === "result" && !!lastRound?.allDone;
}

/** 右上角菜单转发：等待开局时发邀请，终局结算时发战绩 */
function shareContext(): ShareOpts {
  if (onlineFinal()) return resultShare();
  if (!offline && net.room && net.state?.phase === "WAITING") return inviteShare();
  return { title: "捡红点 · 新中式扑克，来一局" };
}
setupShare(shareContext);

// ---------- 表情 ----------

const EMOTE_COOLDOWN_MS = 1200;
let lastSocialAt = 0;
let bubbleText = "";
let bubbleUntil = 0;

function showBubble(name: string, text: string, isEmote: boolean): void {
  const icon = isEmote ? EMOTES.find((e) => e.id === text)?.icon ?? "💬" : "💬";
  bubbleText = `${icon} ${name}：${text}`;
  bubbleUntil = now() + 2800;
}

/** 预设表情 / 快捷语；离线时只在本机展示 */
function sendSocial(text: string, isEmote: boolean): void {
  screen = "none";
  if (now() - lastSocialAt < EMOTE_COOLDOWN_MS) return toast("发送太快了");
  lastSocialAt = now();
  if (offline) return showBubble(playerName(), text, isEmote);
  if (!net.room) return toast("未连接房间");
  if (isEmote) net.emote(text);
  else net.chat(text);
}

// ---------- 结算 / 菜单 ----------

/** 积分表：玩家为列，累计 + 各轮净胜（+ 本轮已吃 / 吃牌） */
function scoreBoard(opts: { highlightRound?: number; live?: boolean; piles?: number[][] }): Board {
  const state = playState();
  const players = state ? ([...state.players.values()] as any[]).sort((a, b) => a.seat - b.seat) : [];
  const mySeat = mySeatNow();
  const seats = players.map((p) => Number(p.seat) || 0);
  return {
    cols: players.map((p) => ({
      name: String(p.name || "玩家"),
      ai: !!p.isAi && !String(p.name).startsWith("机器人"),
      me: p.seat === mySeat,
    })),
    totals: players.map((p) => seatMatchTotal(p.seat, Number(p.totalNet) || 0)),
    rounds: matchRoundNets.map((row) => seats.map((s) => row[s] ?? 0)),
    highlightRound: opts.highlightRound,
    live: opts.live ? players.map((p) => Number(p.points) || 0) : undefined,
    piles: opts.piles
      ? seats.map((s) => (opts.piles![s] ?? []).map((id) => ({ text: cardName(id), red: isRed(id) })))
      : undefined,
  };
}

function resultTitle(r: RoundOver): string {
  if (!r.allDone) return `第 ${r.round} 轮结算`;
  const players = ([...(playState()?.players.values() ?? [])] as any[]).map((p) => ({
    seat: p.seat,
    total: seatMatchTotal(p.seat, Number(p.totalNet) || 0),
  }));
  const winner = players.sort((a, b) => b.total - a.total)[0];
  const iWin = winner?.seat === mySeatNow() && winner.total >= 0;
  return iWin ? "最终结算 · 胜" : `最终结算（${r.round} 轮）`;
}

/** 画布确认框（对应 Web 的换座 / 结算对局弹窗） */
let dialog: Dialog | null = null;

function ask(title: string, text: string, okLabel = "确定", cancelLabel = "取消"): Promise<boolean> {
  dialog?.onCancel();
  return new Promise((resolve) => {
    const close = (v: boolean) => {
      dialog = null;
      resolve(v);
    };
    dialog = { title, text, okLabel, cancelLabel, onOk: () => close(true), onCancel: () => close(false) };
  });
}

function again(): void {
  pendingRoundOver = null;
  if (offline) {
    if (lastRound?.allDone) {
      matchRoundNets = [];
      offline.start();
    } else offline.continueRound();
    screen = "none";
    return;
  }
  if (lastRound?.allDone) matchRoundNets = [];
  net.nextRound();
  if (lastRound && !lastRound.allDone) toast("已确认，等待其他玩家…");
  screen = "none";
}

function exitToLobby(): void {
  if (offline) {
    stopOffline();
    goLobby();
    return;
  }
  void guard(leaveOnline);
}

async function settleMatch(): Promise<void> {
  if (!(await ask("结算对局", "确定结算本场对局？", "确定结算"))) return;
  view.resetAnimVisuals();
  if (offline) offline.endMatch();
  else net.endMatch();
  screen = "none";
}

async function leaveMidGame(): Promise<void> {
  const tip = offline
    ? "进度已自动保存，可在大厅继续"
    : spectating()
      ? "退出观战？"
      : "退出后座位由机器人托管，确定退出？";
  if (!(await ask(spectating() ? "退出观战" : "返回大厅", tip))) return;
  exitToLobby();
}

function resultButtons(r: RoundOver): BtnSpec[] {
  if (spectating()) return [{ label: "退出观战", onTap: exitToLobby }];
  if (r.allDone)
    return [
      { label: offline ? "再练一局" : "再来一局", primary: true, onTap: again },
      ...(offline ? [] : [{ label: "分享战绩", onTap: () => share(resultShare()) }]),
      { label: "返回大厅", onTap: exitToLobby },
    ];
  const next = { label: "继续下一轮", pulse: true, onTap: again };
  return isHost() ? [next, { label: "结算本场", primary: true, onTap: () => void settleMatch() }] : [next];
}

function themeCards(): ThemeCard[] {
  return THEME_IDS.map((id) => ({
    id,
    label: THEMES[id].name,
    on: id === currentThemeId(),
    onTap: () => setThemeLocalAndRemote(id),
  }));
}

function menuRows(): BtnSpec[][] {
  const scores = { label: "查看当前积分", onTap: () => (screen = "scores") };
  if (spectating()) return [[scores], [{ label: "退出观战", onTap: () => void leaveMidGame() }]];
  const rows: BtnSpec[][] = [[scores]];
  if (isHost() && !lastRound?.allDone)
    rows.push([{ label: "结算对局", primary: true, onTap: () => void settleMatch() }]);
  rows.push([{ label: offline ? "返回大厅" : "退出房间", onTap: () => void leaveMidGame() }]);
  return rows;
}

function scoresSub(): string {
  const state = playState();
  if (!state?.round) return "尚未完成轮次";
  return state.phase === "PLAYING" ? `第 ${state.round} 轮进行中` : `已打 ${state.round} 轮`;
}

// ---------- 绘制与输入 ----------

function drawOverlay(): void {
  overlay.begin();
  const state = playState();
  if (screen === "lobby" || screen === "nick") {
    drawLobby(overlay, {
      name: storage.get("jhd.name") ?? "",
      onName: () => void editName(),
      nickLabel: platformNickLabel,
      onNick: onNickTap,
      maxPlayers,
      onCount: (n) => (maxPlayers = n),
      themes: themeCards(),
      practiceLabel: hasLocalSave() ? "继续人机练习" : "人机练习（可离线）",
      onPractice: startOffline,
      resume: resumeAvailable ? { label: "回到未完成对局", onTap: resumeOnline } : undefined,
      onMatch: () =>
        enterOnline(async () => {
          await net.quickMatch(playerName(), maxPlayers, currentThemeId());
          net.ready(true);
        }, "room"),
      onCreate: () => enterOnline(() => net.create(playerName(), maxPlayers, currentThemeId()), "room"),
      onJoin: () => openCodePad("join"),
      onSpectate: () => openCodePad("spectate"),
      onRank: openRank,
      onRules: openRules,
      onAge: () => (ageOpen = true),
    });
    if (screen === "nick")
      drawNickPrompt(overlay, {
        nickLabel: platformNickLabel,
        onNick: onNickTap,
        onManual: () => void editName(),
        onLater: () => (screen = "lobby"),
      });
  } else if (screen === "code") {
    drawCodePad(overlay, {
      title: codeMode === "join" ? "加入房间" : "观战房间",
      okLabel: codeMode === "join" ? "确认加入" : "确认观战",
      code: codeInput,
      onDigit: (d) => (codeInput = (codeInput + d).slice(0, 6)),
      onDel: () => (codeInput = codeInput.slice(0, -1)),
      onClear: () => (codeInput = ""),
      onOk: submitCode,
      onCancel: goLobby,
    });
  } else if (screen === "room" && state) {
    const me = net.room ? state.players.get(net.room.sessionId) : null;
    const full = listRoomPlayers(state).length >= state.maxPlayers;
    drawRoom(overlay, {
      code: String(state.code || ""),
      ...roomView(state),
      actions: net.spectating
        ? [{ label: "退出观战", onTap: exitToLobby }]
        : [
            { label: "＋ 添加机器人", onTap: () => net.addAi(), disabled: full || !isHost() },
            { label: me?.ready ? "取消准备" : "准备", primary: true, onTap: () => net.ready(!me?.ready) },
          ],
      links: net.spectating
        ? []
        : full
          ? [{ label: "离开房间", onTap: exitToLobby }]
          : [
              { label: "邀请好友", onTap: () => share(inviteShare()) },
              { label: "离开房间", onTap: exitToLobby },
            ],
    });
  } else if (screen === "result" && lastRound) {
    const r = lastRound;
    drawResult(overlay, {
      title: resultTitle(r),
      round: r.round,
      code: offline ? undefined : String(state?.code || ""),
      board: scoreBoard({
        highlightRound: r.allDone || r.base === 0 ? undefined : r.round,
        piles: r.allDone ? undefined : r.captured,
      }),
      buttons: resultButtons(r),
    });
  } else if (screen === "menu") {
    drawMenu(overlay, {
      themes: isHost() && !spectating() ? themeCards() : undefined,
      rows: menuRows(),
      onClose: () => (screen = "none"),
    });
  } else if (screen === "scores") {
    drawScores(overlay, {
      sub: scoresSub(),
      code: offline ? undefined : String(state?.code || ""),
      board: scoreBoard({ live: state?.phase === "PLAYING" }),
      onClose: () => (screen = "none"),
    });
  } else if (screen === "rank") {
    const me = deviceId();
    drawRank(overlay, {
      loading: rankLoading,
      rows: rankRows.map((r, i) => ({
        rank: i + 1,
        name: r.name,
        games: r.games,
        wins: r.wins,
        totalNet: r.totalNet,
        me: r.deviceId === me,
      })),
      onClose: goLobby,
    });
  } else if (screen === "guide") {
    drawGuide(overlay, {
      onOk: () => {
        storage.set("jhd.guided", "1");
        screen = "none";
      },
    });
  } else if (screen === "rules") {
    drawRules(overlay, { onClose: () => (screen = rulesBack) });
  } else if (screen === "emote") {
    drawEmotes(overlay, {
      onEmote: (id) => sendSocial(id, true),
      onPhrase: (t) => sendSocial(t, false),
      onClose: () => (screen = "none"),
    });
  } else {
    if (hintText)
      overlay.pill(hintText, overlay.w / 2, overlay.h * 0.77 - 12, {
        bg: "rgba(184,53,43,0.85)",
        color: "#fff3e4",
        h: 32,
      });
    if (state && state.phase !== "WAITING") {
      let x = overlay.inset + 10;
      x += overlay.chip("菜单", x, 4, () => (screen = "menu")) + 8;
      x += overlay.chip("?", x, 4, openRules, true) + 8;
      x += overlay.chip("♪", x, 4, () => sfx.toggleMute(), true, sfx.muted) + 8;
      overlay.chip("💬", x, 4, () => (screen = "emote"), true);
    }
  }
  if (dialog) drawDialog(overlay, dialog);
  if (privacyPending.length)
    drawPrivacy(overlay, {
      contractName: privacyName,
      onOpen: () => openPrivacyContract(() => toast("暂时无法打开隐私指引")),
      onAgree: () => answerPrivacy(true),
      onDisagree: () => answerPrivacy(false),
      onAge: () => (ageOpen = true),
    });
  if (ageOpen) drawAgeHint(overlay, { onClose: () => (ageOpen = false) });
  if (bubbleText && now() < bubbleUntil)
    overlay.pill(bubbleText, overlay.w / 2, overlay.h / 2, {
      bg: alpha(UI.felt, 0.95),
      color: UI.gold,
      border: UI.gold,
      size: 18,
      h: 50,
    });
  if (toastText && now() < toastUntil)
    overlay.pill(toastText, overlay.w / 2, overlay.h * 0.12, {
      bg: "rgba(8,24,18,0.92)",
      border: UI.goldDim,
      size: 15,
      h: 40,
    });
  if (__DEV__ && demoImg) {
    overlay.screenBg(true);
    overlay.image(demoImg, (overlay.w - 450) / 2, (overlay.h - 360) / 2, 450, 360);
  }
  // 原生昵称授权按钮：大厅 / 昵称引导时盖在「用微信昵称」上
  const nick =
    (screen === "lobby" || screen === "nick") && !dialog && !demoImg && !ageOpen && !privacyPending.length
      ? [...overlay.hits].reverse().find((b) => b.label === platformNickLabel)
      : undefined;
  syncNickButton(nick ?? null, applyPlatformNick);
  if (__DEV__)
    overlay.text(`f${frames} ${screen} n${maxPlayers}`, overlay.inset + 8, overlay.h - 10, {
      size: 10,
      align: "left",
      color: "rgba(255,255,255,0.4)",
    });
}

function forEachTouch(e: MiniTouchEvent, fn: (t: MiniTouchEvent["changedTouches"][number]) => void): void {
  for (const t of e.changedTouches) fn(t);
}

let audioReady = false;
api.onTouchStart((e) => {
  if (!audioReady) {
    audioReady = true;
    sfx.unlock();
    sfx.startBgm();
  }
  const t = e.changedTouches[0];
  if (!t || overlay.press(t.clientX, t.clientY)) return;
  if (screen === "none") view.touchStart(t);
});
api.onTouchMove((e) => forEachTouch(e, (t) => view.touchMove(t)));
api.onTouchEnd((e) => {
  const t = e.changedTouches[0];
  if (t) overlay.release(t.clientX, t.clientY);
  forEachTouch(e, (t) => view.touchEnd(t));
});
api.onTouchCancel((e) => {
  overlay.cancel();
  forEachTouch(e, (t) => view.touchEnd(t));
});
api.onHide(() => {
  offline?.flushSave();
  sfx.stopBgm();
});
api.onShow?.((res) => {
  if (audioReady) sfx.startBgm();
  if (!res.query?.room) onForeground();
});

/**
 * 启动：先确认隐私协议（未同意过则弹全屏隐私页）；同意后若还没有昵称，
 * 之前授权过就静默填入，否则弹昵称引导。
 */
if (!__DEMO__)
  void requirePrivacy().then((agreed) => {
    if (!agreed || storage.get("jhd.name")) return;
    void silentNickname().then((n) => {
      if (storage.get("jhd.name")) return;
      if (n) storage.set("jhd.name", n.slice(0, 10));
      else askNicknameOnce();
    });
  });

let invited = false;
onInviteCode((code) => {
  invited = true;
  joinInvite(code);
});
if (!invited && !__AUTOSTART__)
  void net.tryResumeSeat(playerName()).then((ok) => {
    if (ok) toast("已回到未完成的对局");
    else if (screen === "lobby") goLobby();
  });

declare const __DEV__: boolean;
declare const __AUTOSTART__: number;
declare const __DEMO__: string;
let demoImg: HTMLImageElement | null = null;
let frames = 0;
if (__DEV__) {
  (globalThis as Record<string, unknown>).__jhd = {
    view,
    overlay,
    net,
    get screen() {
      return screen;
    },
    get offline() {
      return offline;
    },
    get frames() {
      return frames;
    },
    get lastRound() {
      return lastRound;
    },
  };
  if (__DEMO__) storage.set("jhd.guided", "1");
  if (__AUTOSTART__) {
    maxPlayers = __AUTOSTART__;
    startOffline();
  }
  if (__DEMO__ === "rank") openRank();
  else if (__DEMO__ === "result") {
    (offline as LocalPlay | null)?.endMatch();
    pendingRoundOver = null;
    screen = "result";
  } else if (__DEMO__ === "dialog") void settleMatch();
  else if (__DEMO__ === "privacy") privacyPending = [() => undefined];
  else if (__DEMO__ === "age") ageOpen = true;
  else if (__DEMO__ === "invitecard" || __DEMO__ === "resultcard") {
    const path =
      __DEMO__ === "invitecard"
        ? inviteCard({ code: "735621", seated: 2, max: 4, host: playerName() })
        : resultCard({
            title: "最终结算（3 轮）",
            rows: [
              { name: playerName(), total: 38, me: true },
              { name: "机器人 1", total: 6, me: false },
              { name: "机器人 2", total: -12, me: false },
              { name: "机器人 3", total: -32, me: false },
            ],
          });
    if (path) void loadImage(path).then((img) => (demoImg = img));
    else toast("卡片导出失败");
  }
  else if (__DEMO__ === "room")
    enterOnline(async () => {
      await net.create(playerName(), 3, currentThemeId());
      net.addAi();
    }, "room");
  else if (__DEMO__) screen = __DEMO__ as Screen;
}

let last = now();
function frame(): void {
  frames++;
  const t = now();
  const dt = Math.min(0.12, (t - last) / 1000);
  last = t;
  if (!bootFailed()) {
    try {
      if ((offline || net.room) && !view.handDragging) adoptHand(offline ? offline.hand : net.hand);
      if (dealRoundPending) view.syncDealHidden();
      if (dealRoundPending) tryStartDealAnim();
      view.render(dt);
      flushRoundOverIfReady();
      if (playState()?.phase === "PLAYING") {
        syncSelection();
        refreshTurnHint();
      }
      drawOverlay();
    } catch (e) {
      console.error("[jhd] frame", e);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
