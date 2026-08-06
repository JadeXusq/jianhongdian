import {
  _decorator,
  Component,
  Graphics,
  Node,
  UITransform,
  Color,
  Vec3,
  Layers,
  Size,
  Label,
  sys,
  tween,
} from "cc";
import { createCard, addLabel, loadCardAtlas } from "./CardNode";
import {
  findTargets,
  cardScore,
  MATCH_HOLD_S,
  HIT_HOLD_S,
  FLY_TARGET_HOLD_S,
  DISCARD_HOLD_S,
  ROUND_RESULT_MAX_WAIT_MS,
  turnHint,
  type GameEvent,
} from "./rules";
import { Net, type RoundOver } from "./Net";
import { LocalPlay } from "./LocalPlay";
import { LobbyUI } from "./LobbyUI";
import { C, DESIGN, HAND_W, TABLE_CARD_W, CARD_RATIO } from "./Theme";

const { ccclass } = _decorator;

/**
 * 牌桌入口：纯代码建节点。
 * 联机由 Net 驱动；人机练习走 LocalPlay（离线），大厅/房间/结算由 LobbyUI 承担。
 */
@ccclass("GameEntry")
export class GameEntry extends Component {
  net!: Net;
  private offline: LocalPlay | null = null;
  private ui!: LobbyUI;
  private hand: number[] = [];
  private selected = -1;
  private discardArmed = -1;
  private targets: number[] = [];
  private lastRound: RoundOver | null = null;
  private hintText = "";
  private tableVisible = false;
  private matchBusy = false;
  private showCaptured = false;
  private stockAnimCredit = 0;
  private wasMyTurn = false;
  private deferredReveal = new Set<number>();
  private lastTableIds: number[] = [];
  private lastPending = -1;
  private pendingRoundOver: RoundOver | null = null;
  private roundOverWaitStarted = 0;
  private pendingGain = new Map<number, number>();
  private pendingCards = new Map<number, Set<number>>();
  private pendingHand = new Map<number, number>();
  private pendingDiscardHands: number[] = [];
  private visualTurnSeat: number | null = null;
  private matchCommit: {
    seat: number;
    cards: number[];
    gain: number;
    hand?: boolean;
  } | null = null;
  private matchQueue: Array<{
    cardId: number;
    targetId: number;
    seat: number;
    fromStock: boolean;
    commitHand: boolean;
  }> = [];
  private lingerCards = new Set<number>();
  private lastTablePos = new Map<number, { x: number; y: number }>();
  private hitTargetId = -1;

  private feltNode!: Node;
  private tableNode!: Node;
  private handNode!: Node;
  private deckNode!: Node;
  private infoNode!: Node;
  private matchNode!: Node;

  start(): void {
    this.net = new Net();
    this.feltNode = this.makeContainer("Felt");
    this.tableNode = this.makeContainer("Table");
    this.handNode = this.makeContainer("Hand");
    this.deckNode = this.makeContainer("Deck");
    this.infoNode = this.makeContainer("Info");
    this.matchNode = this.makeContainer("Match");
    this.matchNode.active = false;

    this.drawFelt();
    this.setTableVisible(false);
    this.bindNet();
    this.ui = new LobbyUI(this.node, {
      onMatch: (name, n) => this.guard(() => this.doMatch(name, n)),
      onCreate: (name, n) => this.guard(() => this.doCreate(name, n)),
      onJoin: (name, code) => this.guard(() => this.doJoin(name, code)),
      onSpectate: (name, code) => this.guard(() => this.doSpectate(name, code)),
      onPractice: (name, n) => this.startOffline(name, n),
      onAccount: () => {
        try {
          const acc = localStorage.getItem("jhd.accountId");
          this.ui.setAccountStatus(
            acc ? `已绑定 ${acc}` : "未绑定（游客战绩仅存本机）"
          );
        } catch {
          this.ui.setAccountStatus("未绑定");
        }
        this.ui.show("account");
      },
      onAccCreate: (name) => this.guard(() => this.doAccCreate(name)),
      onAccBind: (id, tok) => this.guard(() => this.doAccBind(id, tok)),
      onEmote: (id) => this.sendEmote(id),
      onChat: (text) => this.sendChat(text),
      onReady: () => {
        if (this.offline) return;
        const me = this.net.state?.players.get(this.net.room!.sessionId);
        this.net.ready(!me?.ready);
      },
      onAddAi: () => {
        if (!this.offline) this.net.addAi();
      },
      onQuit: () => this.guard(() => this.doQuit()),
      onAgain: () => {
        if (this.offline) {
          if (this.lastRound?.allDone) this.offline.start();
          else this.offline.continueRound();
          this.lastRound = null;
          this.ui.show("none");
          return;
        }
        this.net.nextRound();
        this.ui.toast("已确认，等待其他玩家…");
        this.ui.show("none");
      },
      onExit: () => this.guard(() => this.doQuit()),
      onGuideOk: () => {
        try {
          localStorage.setItem("jhd.guided", "1");
        } catch {
          /* ignore */
        }
        this.ui.show("none");
        this.ui.setHelpVisible(true);
        this.ui.setEmotesVisible(true);
        this.ui.setChatToggleVisible(true);
        this.ui.setMenuVisible(true);
      },
      onOpenRules: () => {
        this.ui.setHelpVisible(false);
      },
      onRulesClose: () => {
        if (this.ui.isOverlay()) {
          this.ui.setHelpVisible(false);
          return;
        }
        const playing = this.playState()?.phase === "PLAYING";
        const midRound =
          this.playState()?.phase === "ROUND_OVER" &&
          !!this.lastRound &&
          !this.lastRound.allDone;
        if (playing || midRound) {
          this.ui.setHelpVisible(true);
          this.ui.setEmotesVisible(playing);
          this.ui.setChatToggleVisible(true);
          this.ui.setMenuVisible(
            !this.lastRound?.allDone && (!!this.offline || !this.net.spectating)
          );
        } else {
          this.ui.setHelpVisible(false);
          this.ui.setMenuVisible(false);
        }
      },
      onMenuScores: () => {
        const state = this.playState();
        if (state) this.ui.renderScores(state, this.mySeatNum());
      },
      onMenuSettle: () => {
        if (this.offline) {
          this.matchBusy = false;
          this.matchQueue = [];
          this.hitTargetId = -1;
          this.deferredReveal.clear();
          this.offline.endMatch();
          this.ui.show("none");
          return;
        }
        this.net.endMatch();
        this.ui.show("none");
      },
      onMenuRestart: () => {
        if (!this.offline) return;
        this.lastRound = null;
        this.selected = -1;
        this.discardArmed = -1;
        this.showCaptured = false;
        this.deferredReveal.clear();
        this.matchQueue = [];
        this.matchBusy = false;
        this.hitTargetId = -1;
        this.offline.start();
        this.ui.show("none");
        this.ui.setHelpVisible(true);
        this.ui.setMenuVisible(true);
        this.ui.toast("已重新开始");
      },
      isHost: () => {
        if (this.offline) return true;
        if (!this.net.room || !this.net.state) return false;
        return this.net.state.hostSessionId === this.net.room.sessionId;
      },
      canSettleMatch: () => {
        if (this.lastRound?.allDone) return false;
        if (this.offline) return true;
        if (!this.net.room || !this.net.state) return false;
        return this.net.state.hostSessionId === this.net.room.sessionId;
      },
      canRestartMatch: () => !!this.offline && !this.lastRound?.allDone,
    });

    void loadCardAtlas().then((ok) => {
      if (ok) console.log("[card] 位图图集已加载");
    });

    this.matchNode.setSiblingIndex(this.node.children.length - 1);

    const q =
      typeof location !== "undefined" ? location.search || "" : "";
    if (/[?&]auto=1/.test(q)) {
      this.guard(async () => {
        await this.doCreate("Cocos玩家", 2, true);
        this.net.ready(true);
      });
    }

    (globalThis as any).__gameEntry = this;
    (globalThis as any).__Net = Net;
  }

  private makeContainer(name: string): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    this.node.addChild(n);
    return n;
  }

  private setTableVisible(v: boolean): void {
    this.tableVisible = v;
    this.tableNode.active = v;
    this.handNode.active = v;
    this.deckNode.active = v;
    this.infoNode.active = v;
  }

  private async guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.ui.toast((e as Error).message || "连接失败，请确认服务器已启动");
      console.error(e);
    }
  }

  private async doMatch(name: string, maxPlayers: number): Promise<void> {
    this.stopOffline();
    this.ui.clearChatLog();
    await this.net.quickMatch(name, maxPlayers);
    this.net.ready(true);
    this.ui.setChatToggleVisible(true);
    this.ui.show("room");
  }

  private async doCreate(
    name: string,
    maxPlayers: number,
    withAi = false
  ): Promise<void> {
    this.stopOffline();
    this.ui.clearChatLog();
    await this.net.create(name, maxPlayers);
    if (withAi) this.net.addAi();
    this.ui.setChatToggleVisible(true);
    this.ui.show("room");
  }

  private async doJoin(name: string, code: string): Promise<void> {
    this.stopOffline();
    this.ui.clearChatLog();
    await this.net.joinByCode(name, code);
    this.ui.setChatToggleVisible(true);
    this.ui.show("room");
  }

  private async doSpectate(name: string, code: string): Promise<void> {
    this.stopOffline();
    this.ui.clearChatLog();
    await this.net.spectateByCode(name, code);
    this.ui.toast("已进入观战");
    this.setTableVisible(true);
    this.ui.show("none");
    this.ui.setEmotesVisible(true);
    this.ui.setChatToggleVisible(true);
    this.hintText = "观战中";
    this.render();
  }

  private async doAccCreate(name: string): Promise<void> {
    const data = await this.net.createAccount(name);
    try {
      localStorage.setItem("jhd.accountId", data.accountId);
      localStorage.setItem("jhd.accountToken", data.token);
    } catch {
      /* ignore */
    }
    await this.net.bindAccount(data.accountId, data.token);
    this.ui.setAccountStatus(
      `已绑定 ${data.accountId}`,
      `请保存凭证：${data.token}`
    );
    this.ui.toast("账号已创建并绑定");
  }

  private async doAccBind(accountId: string, token: string): Promise<void> {
    const profile = await this.net.bindAccount(accountId, token);
    try {
      localStorage.setItem("jhd.accountId", accountId);
      localStorage.setItem("jhd.accountToken", token);
    } catch {
      /* ignore */
    }
    this.ui.setAccountStatus(
      `已绑定 ${accountId}`,
      `战绩 ${profile.games} 局 · 净分 ${profile.totalNet}`
    );
    this.ui.toast("绑定成功");
  }

  private async doQuit(): Promise<void> {
    if (this.offline) {
      this.stopOffline();
      this.resetLocal();
      this.setTableVisible(false);
      this.ui.setEmotesVisible(false);
      this.ui.setChatToggleVisible(false);
      this.ui.clearChatLog();
      this.ui.setHelpVisible(false);
      this.ui.show("lobby");
      return;
    }
    await this.net.leave();
    this.resetLocal();
    this.setTableVisible(false);
    this.ui.setChatToggleVisible(false);
    this.ui.clearChatLog();
    this.ui.show("lobby");
  }

  private stopOffline(): void {
    this.offline?.stop();
    this.offline = null;
    this.ui?.setMenuVisible(false);
    this.ui?.setChatToggleVisible(false);
    this.ui?.clearChatLog();
  }

  private startOffline(name: string, playerCount: number): void {
    this.stopOffline();
    this.ui.clearChatLog();
    void this.net.leave().catch(() => undefined);
    this.resetLocal();
    this.deferredReveal.clear();
    this.lastTableIds = [];
    this.lastPending = -1;
    this.stockAnimCredit = 0;
    try {
      localStorage.setItem("jhd.name", name);
    } catch {
      /* ignore */
    }
    const session = new LocalPlay(name, playerCount);
    this.offline = session;

    session.onState = (state) => {
      this.hand = session.hand.slice();
      if (state.phase === "PLAYING") {
        const table: number[] = [...state.table];
        if (this.lastTableIds.length > 0) {
          const old = new Set(this.lastTableIds);
          for (const id of table) {
            if (!old.has(id)) this.deferredReveal.add(id);
          }
        }
        if (
          typeof state.pendingStockCard === "number" &&
          state.pendingStockCard >= 0 &&
          state.pendingStockCard !== this.lastPending
        ) {
          this.deferredReveal.add(state.pendingStockCard);
        }
        this.lastTableIds = table;
        this.lastPending = state.pendingStockCard ?? -1;
        this.setTableVisible(true);
        if (!this.ui.isOverlay()) {
          this.ui.show("none");
          this.ui.setEmotesVisible(true);
          this.ui.setChatToggleVisible(true);
          this.ui.setHelpVisible(true);
          this.ui.setMenuVisible(true);
        } else {
          this.ui.setEmotesVisible(false);
          this.ui.setChatToggleVisible(false);
        }
        this.syncSelection();
        this.refreshTurnHint();
      } else if (state.phase === "ROUND_OVER") {
        this.ui.setEmotesVisible(false);
        this.ui.setChatToggleVisible(true);
        this.ui.setHelpVisible(true);
        this.ui.setMenuVisible(!this.lastRound?.allDone);
      }
      if (this.tableVisible && !this.matchBusy) this.render();
    };

    session.onRoundStart = () => {
      this.selected = -1;
      this.discardArmed = -1;
      this.targets = [];
      this.lastRound = null;
      this.showCaptured = false;
      this.pendingGain.clear();
      this.pendingCards.clear();
      this.pendingHand.clear();
      this.pendingDiscardHands = [];
      this.visualTurnSeat = null;
      this.matchCommit = null;
      this.matchQueue = [];
      this.lingerCards.clear();
      this.lastTablePos.clear();
      this.hitTargetId = -1;
      this.matchBusy = false;
      this.hand = session.hand.slice();
      this.hintText = "新一轮开始";
      this.setTableVisible(true);
      let guided = false;
      try {
        guided = localStorage.getItem("jhd.guided") === "1";
      } catch {
        /* ignore */
      }
      if (!guided) {
        this.ui.show("guide");
        this.ui.setEmotesVisible(false);
        this.ui.setHelpVisible(false);
        this.ui.setMenuVisible(false);
      } else {
        this.ui.show("none");
        this.ui.setEmotesVisible(true);
        this.ui.setHelpVisible(true);
        this.ui.setMenuVisible(true);
      }
      this.render();
    };

    session.onEvents = (events: GameEvent[]) => {
      this.hand = session.hand.slice();
      this.handleMoveEvents(events);
    };

    session.onRoundOver = (r) => {
      this.queueRoundOver({
        points: r.points,
        net: r.net,
        base: r.base,
        round: r.round,
        totalRounds: r.totalRounds,
        allDone: r.allDone,
        captured: Array.from({ length: playerCount }, () => []),
      });
    };

    session.start();
    this.ui.toast(`人机练习（离线）· ${playerCount} 人`);
  }

  private queueRoundOver(r: RoundOver): void {
    this.lastRound = r;
    this.pendingRoundOver = r;
    this.roundOverWaitStarted = Date.now();
    this.unschedule(this.tryFlushRoundOver);
    this.unschedule(this.forceFlushRoundOver);
    this.scheduleOnce(this.tryFlushRoundOver, 0.2);
    this.scheduleOnce(
      this.forceFlushRoundOver,
      ROUND_RESULT_MAX_WAIT_MS / 1000
    );
  }

  private tryFlushRoundOver = (): void => {
    if (!this.pendingRoundOver) return;
    const busy =
      this.matchBusy ||
      this.deferredReveal.size > 0 ||
      this.stockAnimCredit > 0 ||
      this.pendingDiscardHands.length > 0;
    const waited = Date.now() - this.roundOverWaitStarted;
    if (busy && waited < ROUND_RESULT_MAX_WAIT_MS) {
      this.scheduleOnce(this.tryFlushRoundOver, 0.12);
      return;
    }
    this.flushRoundOver();
  };

  private forceFlushRoundOver = (): void => {
    if (this.pendingRoundOver) this.flushRoundOver();
  };

  private flushRoundOver(): void {
    const r = this.pendingRoundOver;
    if (!r) return;
    this.pendingRoundOver = null;
    this.unschedule(this.tryFlushRoundOver);
    this.unschedule(this.forceFlushRoundOver);
    const state = this.playState();
    if (!state) return;
    this.ui.setEmotesVisible(false);
    this.ui.setChatToggleVisible(true);
    this.ui.setHelpVisible(true);
    this.ui.setMenuVisible(
      !r.allDone && (!!this.offline || !this.net.spectating)
    );
    this.ui.renderResult(
      r,
      state,
      this.mySeatNum(),
      this.offline ? "再练一局" : "再来一局"
    );
    this.ui.show("result");
  }

  async joinByCode(name: string, code: string): Promise<void> {
    this.stopOffline();
    this.ui.clearChatLog();
    await this.net.leave().catch(() => undefined);
    this.resetLocal();
    await this.net.joinByCode(name, code);
    this.net.ready(true);
    this.ui.setChatToggleVisible(true);
    this.ui.show("room");
  }

  async createHost(
    name: string,
    maxPlayers: number,
    withAi = false
  ): Promise<string> {
    this.stopOffline();
    this.ui.clearChatLog();
    await this.net.leave().catch(() => undefined);
    this.resetLocal();
    await this.net.create(name, maxPlayers);
    if (withAi) this.net.addAi();
    const code = await this.waitCode();
    this.net.ready(true);
    this.ui.setChatToggleVisible(true);
    this.ui.show("room");
    return code;
  }

  private waitCode(ms = 5000): Promise<string> {
    const hit = this.net.state?.code;
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待房号超时")), ms);
      const prev = this.net.onState;
      this.net.onState = (state) => {
        prev?.(state);
        if (state.code) {
          clearTimeout(timer);
          this.net.onState = prev;
          resolve(state.code);
        }
      };
    });
  }

  async probeNet(wsUrl = "ws://localhost:2567"): Promise<number[]> {
    const net = new Net(wsUrl);
    const hand = await new Promise<number[]>(async (resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("等待 hand 超时")),
        15000
      );
      const done = () => {
        if (!net.hand.length) return;
        clearTimeout(timer);
        resolve(net.hand.slice());
      };
      net.onError = (m) => {
        clearTimeout(timer);
        reject(new Error(m));
      };
      net.onRoundStart = () => {
        done();
        setTimeout(done, 200);
      };
      net.onState = () => done();
      try {
        await net.create("Cocos探针", 2);
        net.addAi();
        net.ready(true);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
    console.log("[Net探针] 收到手牌", hand);
    await net.leave();
    return hand;
  }

  private resetLocal(): void {
    this.hand = [];
    this.selected = -1;
    this.discardArmed = -1;
    this.targets = [];
    this.lastRound = null;
    this.hintText = "";
    this.pendingGain.clear();
    this.pendingCards.clear();
    this.pendingHand.clear();
    this.pendingDiscardHands = [];
    this.visualTurnSeat = null;
    this.matchCommit = null;
    this.matchQueue = [];
    this.lingerCards.clear();
    this.lastTablePos.clear();
    this.hitTargetId = -1;
    this.matchBusy = false;
  }

  private bindNet(): void {
    this.net.onState = (state) => {
      if (this.offline) return;
      this.hand = this.net.hand.slice();
      if (state.phase === "WAITING") {
        this.deferredReveal.clear();
        this.lastTableIds = [];
        this.lastPending = -1;
        this.setTableVisible(false);
        this.ui.setEmotesVisible(false);
        this.ui.setChatToggleVisible(true);
        this.ui.setHelpVisible(false);
        this.ui.setMenuVisible(false);
        this.ui.renderRoom(state, this.net.room!.sessionId);
        if (!this.lastRound) this.ui.show("room");
      } else if (state.phase === "PLAYING") {
        const table: number[] = state.table ? [...state.table] : [];
        if (this.lastTableIds.length > 0) {
          const old = new Set(this.lastTableIds);
          for (const id of table) {
            if (!old.has(id)) this.deferredReveal.add(id);
          }
        }
        if (
          typeof state.pendingStockCard === "number" &&
          state.pendingStockCard >= 0 &&
          state.pendingStockCard !== this.lastPending
        ) {
          this.deferredReveal.add(state.pendingStockCard);
        }
        this.lastTableIds = table;
        this.lastPending = state.pendingStockCard ?? -1;
        this.setTableVisible(true);
        if (!this.ui.isOverlay()) {
          this.ui.show("none");
          this.ui.setEmotesVisible(true);
          this.ui.setChatToggleVisible(true);
          this.ui.setHelpVisible(true);
          this.ui.setMenuVisible(!this.net.spectating);
        } else {
          this.ui.setEmotesVisible(false);
          this.ui.setChatToggleVisible(false);
        }
        this.syncSelection();
        this.refreshTurnHint();
      } else if (state.phase === "ROUND_OVER") {
        this.ui.setEmotesVisible(false);
        this.ui.setChatToggleVisible(true);
        this.ui.setHelpVisible(true);
        this.ui.setMenuVisible(!this.net.spectating && !this.lastRound?.allDone);
      }
      if (this.tableVisible && !this.matchBusy) this.render();
    };

    this.net.onRoundStart = () => {
      if (this.offline) return;
      this.selected = -1;
      this.discardArmed = -1;
      this.targets = [];
      this.lastRound = null;
      this.showCaptured = false;
      this.pendingGain.clear();
      this.pendingCards.clear();
      this.pendingHand.clear();
      this.pendingDiscardHands = [];
      this.visualTurnSeat = null;
      this.matchCommit = null;
      this.matchQueue = [];
      this.lingerCards.clear();
      this.lastTablePos.clear();
      this.hitTargetId = -1;
      this.matchBusy = false;
      this.hand = this.net.hand.slice();
      this.hintText = "新一轮开始";
      this.setTableVisible(true);
      let guided = false;
      try {
        guided = localStorage.getItem("jhd.guided") === "1";
      } catch {
        /* ignore */
      }
      if (!guided) {
        this.ui.show("guide");
        this.ui.setEmotesVisible(false);
        this.ui.setHelpVisible(false);
      } else {
        this.ui.show("none");
        this.ui.setEmotesVisible(true);
        this.ui.setHelpVisible(true);
      }
      this.render();
    };

    this.net.onEvents = (events: GameEvent[]) => {
      if (this.offline) return;
      this.hand = this.net.hand.slice();
      this.handleMoveEvents(events);
    };

    this.net.onRoundOver = (r) => {
      if (this.offline) return;
      this.queueRoundOver(r);
    };

    this.net.onError = (msg) => {
      this.ui.toast(msg);
      this.selected = -1;
      this.discardArmed = -1;
      this.syncSelection();
      if (this.tableVisible) this.render();
    };

    this.net.onEmote = (e) => {
      this.ui.showEmote(e.name, e.id);
      this.ui.addChatEntry({
        name: e.name,
        text: e.id,
        isEmote: true,
        mine: e.seat === this.mySeatNum(),
      });
    };

    this.net.onChat = (e) => {
      this.ui.addChatEntry({
        name: e.name,
        text: e.text,
        isEmote: false,
        mine: e.seat === this.mySeatNum(),
      });
    };

    this.net.onLeave = () => {
      this.ui.clearChatLog();
      this.ui.setChatToggleVisible(false);
      if (this.lastRound) return;
      this.ui.toast("已断开连接");
      this.setTableVisible(false);
      this.ui.setHelpVisible(false);
      this.ui.show("lobby");
    };
  }

  private handleMoveEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === "FLIP" && e.fromStock) this.stockAnimCredit++;
      if (e.type === "FLIP") this.deferredReveal.add(e.card);
    }
    const handPlay = events.find((e) => e.type === "PLAY");
    const captures = events.filter(
      (e): e is GameEvent & { target: number } => e.target !== undefined
    );
    if (captures.length) {
      if (handPlay) this.deferHand(handPlay.player);
      captures.forEach((capture, index) => {
        const gain = cardScore(capture.card) + cardScore(capture.target);
        this.deferCapture(
          capture.player,
          [capture.card, capture.target],
          gain
        );
        this.lingerCards.add(capture.target);
        this.matchQueue.push({
          cardId: capture.card,
          targetId: capture.target,
          seat: capture.player,
          fromStock: capture.type === "FLIP" && !!capture.fromStock,
          commitHand: index === 0 && !!handPlay,
        });
      });
      if (!this.matchBusy && this.hitTargetId < 0) this.playNextMatch();
      return;
    }
    if (events.length) this.visualTurnSeat = events[0].player;
    for (const e of events) {
      if (e.type === "PLAY") {
        this.deferHand(e.player);
        this.pendingDiscardHands.push(e.player);
      }
    }
    const stockFlip = events.find((e) => e.type === "FLIP" && e.fromStock);
    if (stockFlip) {
      const to =
        stockFlip.awaitChoice
          ? { x: -TABLE_CARD_W / 2, y: DESIGN.height / 2 - 140 }
          : this.lastTablePos.get(stockFlip.card) ?? {
              x: 0,
              y: 40,
            };
      this.playStockFlip(stockFlip.card, to.x, to.y, () => {
        this.stockAnimCredit = Math.max(0, this.stockAnimCredit - 1);
        this.revealDeferredFlips();
      });
      return;
    }
    this.unschedule(this.revealDeferredFlips);
    this.scheduleOnce(this.revealDeferredFlips, DISCARD_HOLD_S);
    this.syncSelection();
    if (this.tableVisible && !this.matchBusy) this.render();
  }

  private playStockFlip(
    cardId: number,
    toX: number,
    toY: number,
    onDone: () => void
  ): void {
    this.matchBusy = true;
    const layer = new Node("StockFlip");
    layer.layer = Layers.Enum.UI_2D;
    this.matchNode.active = true;
    this.matchNode.addChild(layer);
    const from = new Vec3(-540, 220, 0);
    const back = createCard(0, TABLE_CARD_W, { faceUp: false });
    back.setPosition(from.clone());
    layer.addChild(back);
    const mid = new Vec3((from.x + toX) / 2, (from.y + toY) / 2, 0);
    tween(back)
      .to(
        0.22,
        { position: mid, scale: new Vec3(0.02, 1, 1) },
        { easing: "sineIn" }
      )
      .call(() => {
        layer.removeAllChildren();
        const face = createCard(cardId, TABLE_CARD_W, { faceUp: true });
        face.setPosition(mid.clone());
        face.setScale(new Vec3(0.02, 1, 1));
        layer.addChild(face);
        tween(face)
          .to(
            0.26,
            {
              position: new Vec3(toX, toY, 0),
              scale: new Vec3(1, 1, 1),
            },
            { easing: "sineOut" }
          )
          .call(() => {
            layer.removeFromParent();
            if (!this.matchQueue.length) {
              this.matchNode.removeAllChildren();
              this.matchNode.active = false;
              this.matchBusy = false;
            }
            onDone();
          })
          .start();
      })
      .start();
    if (this.tableVisible) this.render();
  }

  private playNextMatch(): void {
    const next = this.matchQueue[0];
    if (!next) return;
    this.matchBusy = true;
    this.visualTurnSeat = next.seat;
    this.lingerCards.add(next.targetId);
    if (next.fromStock) {
      const hitPos = this.lastTablePos.get(next.targetId) ?? { x: 0, y: 40 };
      const hitY = hitPos.y - TABLE_CARD_W * CARD_RATIO * 0.28;
      this.playStockFlip(next.cardId, hitPos.x + 6, hitY, () => {
        this.hitTargetId = next.targetId;
        if (this.tableVisible) this.render();
        this.unschedule(this.finishHitThenMatch);
        this.scheduleOnce(
          this.finishHitThenMatch,
          FLY_TARGET_HOLD_S + HIT_HOLD_S
        );
      });
      return;
    }
    this.hitTargetId = next.targetId;
    if (this.tableVisible) this.render();
    this.unschedule(this.finishHitThenMatch);
    this.scheduleOnce(
      this.finishHitThenMatch,
      FLY_TARGET_HOLD_S + HIT_HOLD_S
    );
  }

  private finishHitThenMatch = (): void => {
    const next = this.matchQueue.shift();
    this.hitTargetId = -1;
    if (!next) {
      this.matchBusy = false;
      this.lingerCards.clear();
      return;
    }
    this.lingerCards.delete(next.targetId);
    this.playMatch(
      next.cardId,
      next.targetId,
      next.seat,
      next.fromStock,
      next.commitHand
    );
  };

  private playMatch(
    cardId: number,
    targetId: number,
    seat: number,
    fromStock: boolean,
    commitHand: boolean
  ): void {
    if (fromStock)
      this.stockAnimCredit = Math.max(0, this.stockAnimCredit - 1);
    this.matchBusy = true;
    this.visualTurnSeat = seat;
    const gain = cardScore(cardId) + cardScore(targetId);
    this.matchCommit = {
      seat,
      cards: [cardId, targetId],
      gain,
      hand: commitHand,
    };
    this.unschedule(this.clearMatch);
    this.matchNode.removeAllChildren();
    this.matchNode.active = true;

    const hit = new Node("MatchHit");
    hit.layer = Layers.Enum.UI_2D;
    this.matchNode.addChild(hit);
    hit.addComponent(UITransform).setContentSize(
      new Size(DESIGN.width, DESIGN.height)
    );
    hit.on(Node.EventType.TOUCH_END, () => this.clearMatch());

    const w = TABLE_CARD_W * 1.3;
    const h = w * CARD_RATIO;

    const spark = new Node("Spark");
    spark.layer = Layers.Enum.UI_2D;
    this.matchNode.addChild(spark);
    const sg = spark.addComponent(Graphics);
    const n = gain >= 30 ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = 50 + (i % 3) * 12;
      sg.fillColor = i % 2 ? C.gold : new Color(255, 243, 196);
      sg.circle(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.55 + 20, 3);
      sg.fill();
    }

    const right = createCard(targetId, w);
    const left = createCard(cardId, w);
    right.setPosition(new Vec3(10, h / 2, 0));
    left.setPosition(new Vec3(-w - 10, h / 2, 0));
    this.matchNode.addChild(right);
    this.matchNode.addChild(left);
    addLabel(
      this.matchNode,
      gain > 0 ? `MATCH! +${gain}` : "MATCH!",
      0,
      h / 2 + 36,
      28,
      C.gold,
      true
    );
    addLabel(
      this.matchNode,
      "点击任意处跳过",
      0,
      -DESIGN.height / 2 + (sys.isMobile ? 64 : 48),
      sys.isMobile ? 20 : 18,
      C.gold,
      true
    );

    this.render();
    this.scheduleOnce(this.clearMatch, MATCH_HOLD_S);
  }

  private clearMatch = (): void => {
    if (this.matchCommit) {
      this.applyCaptureCommit(this.matchCommit);
      if (this.matchCommit.hand) this.applyHandCommit(this.matchCommit.seat);
      this.matchCommit = null;
    }
    if (this.matchQueue.length) {
      this.playNextMatch();
      return;
    }
    this.visualTurnSeat = null;
    this.matchNode.removeAllChildren();
    this.matchNode.active = false;
    this.matchBusy = false;
    if (this.stockAnimCredit > 0 || this.deferredReveal.size > 0) {
      if (this.stockAnimCredit > 0)
        this.stockAnimCredit = Math.max(0, this.stockAnimCredit - 1);
      this.unschedule(this.revealDeferredFlips);
      this.scheduleOnce(this.revealDeferredFlips, 0.4);
      if (this.tableVisible) this.render();
      return;
    }
    this.deferredReveal.clear();
    this.refreshTurnHint();
    if (this.tableVisible) this.render();
    this.tryFlushRoundOver();
  };

  private deferCapture(seat: number, cards: number[], gain: number): void {
    this.pendingGain.set(seat, (this.pendingGain.get(seat) ?? 0) + gain);
    let set = this.pendingCards.get(seat);
    if (!set) {
      set = new Set();
      this.pendingCards.set(seat, set);
    }
    for (const id of cards) set.add(id);
  }

  private deferHand(seat: number): void {
    this.pendingHand.set(seat, (this.pendingHand.get(seat) ?? 0) + 1);
  }

  private applyHandCommit(seat: number): void {
    const left = (this.pendingHand.get(seat) ?? 0) - 1;
    if (left <= 0) this.pendingHand.delete(seat);
    else this.pendingHand.set(seat, left);
  }

  private displayHandCount(p: { seat: number; handCount?: number }): number {
    return (p.handCount ?? 0) + (this.pendingHand.get(p.seat) ?? 0);
  }

  private applyCaptureCommit(info: {
    seat: number;
    cards: number[];
    gain: number;
  }): void {
    const left = (this.pendingGain.get(info.seat) ?? 0) - info.gain;
    if (left <= 0) this.pendingGain.delete(info.seat);
    else this.pendingGain.set(info.seat, left);
    const set = this.pendingCards.get(info.seat);
    if (!set) return;
    for (const id of info.cards) set.delete(id);
    if (set.size === 0) this.pendingCards.delete(info.seat);
  }

  private displayPoints(p: { seat: number; points?: number }): number {
    return Math.max(0, (p.points ?? 0) - (this.pendingGain.get(p.seat) ?? 0));
  }

  private displayCaptured(me: {
    seat: number;
    captured?: number[];
  }): number[] {
    const cards: number[] = me.captured ? [...me.captured] : [];
    const pending = this.pendingCards.get(me.seat);
    if (!pending?.size) return cards;
    return cards.filter((id) => !pending.has(id));
  }

  private revealDeferredFlips = (): void => {
    for (const seat of this.pendingDiscardHands) this.applyHandCommit(seat);
    this.pendingDiscardHands = [];
    this.visualTurnSeat = null;
    this.deferredReveal.clear();
    this.refreshTurnHint();
    if (this.tableVisible && !this.matchBusy) this.render();
    this.tryFlushRoundOver();
  };

  private playState(): any {
    return this.offline?.state ?? this.net.state;
  }

  private mySeatNum(): number {
    return this.offline ? this.offline.mySeat : this.net.mySeat;
  }

  private refreshTurnHint(): void {
    const state = this.playState();
    if (!state || state.phase !== "PLAYING") return;
    const spectating = !this.offline && this.net.spectating;
    const mine = this.myTurn();
    const busy =
      this.matchBusy ||
      this.deferredReveal.size > 0 ||
      this.stockAnimCredit > 0 ||
      this.pendingDiscardHands.length > 0;
    this.hintText = turnHint({
      spectating,
      offline: !!this.offline,
      myTurn: mine,
      turnPhase: state.turnPhase,
      busy,
      pickingTable: this.selected >= 0 && this.discardArmed < 0,
      discardConfirm: this.discardArmed >= 0,
    });
    if (!spectating && mine && !busy) this.wasMyTurn = true;
    else this.wasMyTurn = false;
  }

  private myTurn(): boolean {
    if (this.offline) {
      const s = this.offline.state;
      return s.phase === "PLAYING" && s.currentSeat === this.offline.mySeat;
    }
    if (this.net.spectating) return false;
    const s = this.net.state;
    return !!s && s.phase === "PLAYING" && s.currentSeat === this.net.mySeat;
  }

  private syncSelection(): void {
    const state = this.playState();
    if (!state) {
      this.targets = [];
      return;
    }
    if (
      state.turnPhase === "CHOOSE_STOCK_TARGET" &&
      state.currentSeat === this.mySeatNum()
    ) {
      this.targets = findTargets(state.pendingStockCard, [...state.table]);
    } else if (this.selected >= 0) {
      this.targets = findTargets(this.selected, [...state.table]);
    } else {
      this.targets = [];
    }
  }

  private render(): void {
    this.renderDeck();
    this.renderTable();
    this.renderHand();
    this.renderInfo();
  }

  private renderDeck(): void {
    this.deckNode.removeAllChildren();
    const n =
      ((this.playState()?.stockCount as number) ?? 0) + this.stockAnimCredit;
    for (let i = Math.min(3, n) - 1; i >= 0; i--) {
      const card = createCard(0, 66, { faceUp: false });
      card.setPosition(new Vec3(-540 + i * 2, 220 - i * 2, 0));
      this.deckNode.addChild(card);
    }
    const lbl = new Node("DeckLbl");
    lbl.layer = Layers.Enum.UI_2D;
    this.deckNode.addChild(lbl);
    lbl.setPosition(-540 + 33, 120, 0);
    lbl.addComponent(UITransform);
    const l = lbl.addComponent(Label);
    l.string = `牌堆 ${n}`;
    l.fontSize = 18;
    l.color = C.cream;
  }

  private renderTable(): void {
    this.tableNode.removeAllChildren();
    const state = this.playState();
    const table: number[] = state ? [...state.table] : [];
    const cols = Math.min(9, Math.max(1, table.length || 1));
    const gap = 12;
    const rows = Math.max(1, Math.ceil(table.length / cols));
    const rowH = TABLE_CARD_W * CARD_RATIO + gap;
    const totalH = rows * rowH - gap;
    const startY = totalH / 2 - 20;
    const choosing = state?.turnPhase === "CHOOSE_STOCK_TARGET";
    const pending = state?.pendingStockCard as number;

    if (choosing && pending >= 0 && !this.deferredReveal.has(pending)) {
      const pend = createCard(pending, TABLE_CARD_W, { selected: true });
      pend.setPosition(new Vec3(-TABLE_CARD_W / 2, DESIGN.height / 2 - 140, 0));
      this.tableNode.addChild(pend);
      addLabel(
        this.tableNode,
        this.myTurn() ? "选择要吃的牌" : "等待选择目标",
        0,
        DESIGN.height / 2 - 100,
        22,
        C.gold,
        true
      );
    }

    table.forEach((id, i) => {
      if (this.deferredReveal.has(id)) return;
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, table.length - row * cols);
      const rowW = inRow * TABLE_CARD_W + (inRow - 1) * gap;
      const startX = -rowW / 2;
      const isTarget = this.targets.indexOf(id) >= 0;
      const isHit = id === this.hitTargetId;
      const card = createCard(id, TABLE_CARD_W, {
        highlight: isTarget || isHit,
        dim: (this.selected >= 0 || choosing) && !isTarget && !isHit,
      });
      const x = startX + (i % cols) * (TABLE_CARD_W + gap);
      const y = startY - row * rowH;
      this.lastTablePos.set(id, { x, y });
      card.setPosition(new Vec3(x, y, 0));
      if (isTarget) {
        card
          .addComponent(UITransform)
          .setContentSize(new Size(TABLE_CARD_W, TABLE_CARD_W * CARD_RATIO));
        card.on(Node.EventType.TOUCH_END, () => this.onPickTable(id));
      }
      this.tableNode.addChild(card);
    });

    for (const id of this.lingerCards) {
      if (table.indexOf(id) >= 0) continue;
      const pos = this.lastTablePos.get(id);
      if (!pos) continue;
      const isHit = id === this.hitTargetId;
      const card = createCard(id, TABLE_CARD_W, { highlight: isHit });
      card.setPosition(new Vec3(pos.x, pos.y, 0));
      this.tableNode.addChild(card);
    }

    const hit = this.matchQueue[0];
    const hitPos = this.lastTablePos.get(this.hitTargetId);
    if (hit && hitPos) {
      const hitY = hitPos.y - TABLE_CARD_W * CARD_RATIO * 0.28;
      const played = createCard(hit.cardId, TABLE_CARD_W);
      played.setPosition(new Vec3(hitPos.x + 6, hitY, 0));
      this.tableNode.addChild(played);
      addLabel(
        this.tableNode,
        "√",
        hitPos.x + TABLE_CARD_W * 0.82,
        hitY - TABLE_CARD_W * CARD_RATIO * 0.22,
        36,
        C.seal,
        true
      );
    }
  }

  private renderHand(): void {
    this.handNode.removeAllChildren();
    const n = this.hand.length;
    if (!n) return;
    const maxW = DESIGN.width - 200;
    const step = Math.min(HAND_W + 10, maxW / n);
    const totalW = step * (n - 1) + HAND_W;
    const startX = -totalW / 2;
    const baseY = -DESIGN.height / 2 + HAND_W * CARD_RATIO + 30;
    const canPlay =
      this.myTurn() &&
      this.playState()?.turnPhase === "PLAY_HAND" &&
      !this.matchBusy &&
      this.deferredReveal.size === 0 &&
      this.pendingDiscardHands.length === 0;

    const hitPad = sys.isMobile ? 22 : 0;
    this.hand.forEach((id, i) => {
      const k = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
      const lift = this.selected === id ? 22 : 0;
      const discarding = this.discardArmed === id;
      const card = createCard(id, HAND_W, {
        selected: this.selected === id && !discarding,
        discard: discarding,
        dim: !canPlay,
      });
      card.setPosition(
        new Vec3(startX + i * step, baseY - k * k * 10 + lift, 0)
      );
      if (hitPad > 0) {
        const hit = new Node("HitPad");
        hit.layer = Layers.Enum.UI_2D;
        card.insertChild(hit, 0);
        const ht = hit.addComponent(UITransform);
        ht.setAnchorPoint(0, 1);
        ht.setContentSize(
          new Size(HAND_W + hitPad * 2, HAND_W * CARD_RATIO + hitPad * 2)
        );
        hit.setPosition(new Vec3(-hitPad, hitPad, 0));
      }
      card.on(Node.EventType.TOUCH_END, () => this.onPickHand(id));
      this.handNode.addChild(card);
    });
  }

  private renderInfo(): void {
    this.infoNode.removeAllChildren();
    const state = this.playState();
    const players = state ? ([...state.players.values()] as any[]) : [];
    const me = players.find((p) => p.seat === this.mySeatNum());
    const others = players.filter((p) => p.seat !== this.mySeatNum());
    const count = players.length;
    const busy =
      this.matchBusy ||
      this.deferredReveal.size > 0 ||
      this.stockAnimCredit > 0 ||
      this.pendingDiscardHands.length > 0;
    const turnSeat =
      busy && this.visualTurnSeat !== null
        ? this.visualTurnSeat
        : state?.currentSeat;

    // 2 人对手正上方；3/4 人按右→上→左
    others.forEach((p, idx) => {
      let x = 0;
      let y = DESIGN.height / 2 - 70;
      if (count === 2) {
        x = 0;
        y = DESIGN.height / 2 - 58;
      } else if (count === 3) {
        x = idx === 0 ? DESIGN.width / 2 - 120 : -DESIGN.width / 2 + 120;
        y = 40;
      } else {
        const slots = [
          { x: DESIGN.width / 2 - 120, y: 40 },
          { x: 0, y: DESIGN.height / 2 - 58 },
          { x: -DESIGN.width / 2 + 120, y: 40 },
        ];
        const s = slots[idx] ?? slots[0];
        x = s.x;
        y = s.y;
      }
      this.drawPlayerPanel(
        p,
        x,
        y,
        turnSeat === p.seat,
        state?.roundStarter === p.seat
      );
    });

    if (me) {
      this.drawPlayerPanel(
        me,
        -DESIGN.width / 2 + 120,
        -80,
        turnSeat === me.seat,
        state?.roundStarter === me.seat
      );
    }

    const code = state?.code ? `房 ${state.code}` : "";
    addLabel(
      this.infoNode,
      code,
      0,
      DESIGN.height / 2 - 28,
      18,
      C.goldDim,
      true
    );

    if (me) {
      this.drawCapturedPile(this.displayCaptured(me));
    }

    if (this.hintText && !this.lastRound) {
      addLabel(
        this.infoNode,
        this.hintText,
        0,
        -DESIGN.height / 2 + HAND_W * CARD_RATIO + 78,
        18,
        C.seal,
        true
      );
    }
  }

  private drawPlayerPanel(
    p: any,
    x: number,
    y: number,
    active: boolean,
    isStarter = false
  ): void {
    const name = String(p.name ?? "").slice(0, 10);
    const nameW = Math.min(160, Math.max(40, name.length * 17));
    const tagW = (p.isAi ? 22 : 0) + (isStarter ? 28 : 0);
    const panelW = Math.min(220, Math.max(148, 56 + nameW + tagW));
    const panelH = 84;
    const gNode = new Node("Panel");
    gNode.layer = Layers.Enum.UI_2D;
    this.infoNode.addChild(gNode);
    gNode.setPosition(new Vec3(x, y, 0));
    const g = gNode.addComponent(Graphics);
    g.fillColor = new Color(8, 26, 20, 184);
    g.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 12);
    g.fill();
    g.strokeColor = active ? C.gold : new Color(201, 169, 97, 80);
    g.lineWidth = active ? 2 : 1;
    g.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 12);
    g.stroke();
    const title = `${name}${isStarter ? " ·庄" : ""}`;
    addLabel(gNode, title, 0, 16, 17, C.cream, true);
    if (p.isAi) {
      addLabel(gNode, "机", panelW / 2 - 18, 28, 12, C.seal, true);
    }
    addLabel(gNode, `${this.displayPoints(p)} 分`, 0, -6, 15, C.cream);
    addLabel(
      gNode,
      `余 ${this.displayHandCount(p)} 张`,
      0,
      -26,
      13,
      new Color(243, 234, 214, 160)
    );
  }

  private drawCapturedPile(cards: number[]): void {
    if (!cards.length) return;
    const cw = 54;
    const originX = -DESIGN.width / 2 + 40;
    const originY = -DESIGN.height / 2 + cw * CARD_RATIO + 14;
    const step = Math.min(3.2, 28 / Math.max(1, cards.length - 1 || 1));
    const stackW = cw + (cards.length - 1) * step + 36;
    const stackH = cw * CARD_RATIO + (cards.length - 1) * step;
    const stackOffset = (cards.length - 1) * step;
    const hit = new Node("CapHit");
    hit.layer = Layers.Enum.UI_2D;
    this.infoNode.addChild(hit);
    hit.setPosition(
      new Vec3(
        originX + stackW / 2,
        originY + stackOffset / 2 - (cw * CARD_RATIO) / 2,
        0
      )
    );
    hit.addComponent(UITransform).setContentSize(new Size(stackW, stackH));
    hit.on(Node.EventType.TOUCH_END, () => {
      this.showCaptured = !this.showCaptured;
      this.render();
    });
    cards.forEach((id, i) => {
      const c = createCard(id, cw);
      c.setPosition(new Vec3(originX + i * step, originY + i * step, 0));
      this.infoNode.addChild(c);
    });
    addLabel(
      this.infoNode,
      `${cards.length}${this.showCaptured ? " ∧" : " ∨"}`,
      originX + (cards.length - 1) * step + cw + 18,
      originY + 10,
      14,
      C.goldDim,
      true
    );

    if (!this.showCaptured) return;
    const mobile = sys.isMobile;
    const tw = mobile ? 36 : 44;
    const gap = 6;
    const cols = Math.min(cards.length, mobile ? 5 : 8);
    const rows = Math.ceil(cards.length / cols);
    const panelW = cols * (tw + gap) + 16;
    const panelH = rows * (tw * CARD_RATIO + gap) + 48;
    const panel = new Node("CapPanel");
    panel.layer = Layers.Enum.UI_2D;
    this.infoNode.addChild(panel);
    const px = -DESIGN.width / 2 + panelW / 2 + 200;
    const py = -DESIGN.height / 2 + panelH / 2 + 16;
    panel.setPosition(new Vec3(px, py, 0));
    panel.addComponent(UITransform).setContentSize(new Size(panelW, panelH));
    const pg = panel.addComponent(Graphics);
    pg.fillColor = new Color(8, 26, 20, 235);
    pg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 12);
    pg.fill();
    pg.strokeColor = C.gold;
    pg.lineWidth = 1.5;
    pg.roundRect(-panelW / 2, -panelH / 2, panelW, panelH, 12);
    pg.stroke();
    addLabel(panel, "已吃牌（再点关闭）", 0, panelH / 2 - 16, 14, C.gold, true);
    cards.forEach((id, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const c = createCard(id, tw);
      c.setPosition(
        new Vec3(
          -panelW / 2 + 8 + col * (tw + gap),
          panelH / 2 - 28 - row * (tw * CARD_RATIO + gap),
          0
        )
      );
      panel.addChild(c);
    });
    addLabel(panel, "∧", 0, -panelH / 2 + 14, 18, C.gold, true);
    panel.on(Node.EventType.TOUCH_END, () => {
      this.showCaptured = false;
      this.render();
    });
  }

  onPickHand(id: number): void {
    const state = this.playState();
    if (
      !this.myTurn() ||
      this.matchBusy ||
      this.deferredReveal.size > 0 ||
      this.pendingDiscardHands.length > 0 ||
      state?.turnPhase !== "PLAY_HAND"
    )
      return;
    const targets = findTargets(id, [...state.table]);

    if (targets.length === 1) return this.send(id, targets[0]);
    if (targets.length === 0) {
      if (this.discardArmed === id) return this.send(id);
      this.discardArmed = id;
      this.selected = id;
      this.targets = [];
      this.hintText = "无可吃目标 — 再点一次弃牌";
      this.ui.toast("再点一次确认弃牌");
      this.render();
      return;
    }
    this.selected = id;
    this.discardArmed = -1;
    this.targets = targets;
    this.hintText = "选择要吃的桌面牌";
    this.render();
  }

  onPickTable(id: number): void {
    const state = this.playState();
    if (
      !this.myTurn() ||
      this.matchBusy ||
      this.deferredReveal.size > 0 ||
      this.pendingDiscardHands.length > 0 ||
      !state
    )
      return;
    if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
      if (this.targets.indexOf(id) >= 0) {
        if (this.offline) this.offline.chooseTarget(id);
        else this.net.chooseTarget(id);
      }
      return;
    }
    if (this.selected < 0 || this.targets.indexOf(id) < 0) return;
    this.send(this.selected, id);
  }

  private lastEmoteAt = 0;
  private lastChatAt = 0;
  private static readonly EMOTE_IDS = new Set([
    "加油",
    "好牌",
    "厉害",
    "等等",
    "哈哈哈",
  ]);

  private sendEmote(id: string): void {
    if (!GameEntry.EMOTE_IDS.has(id)) return;
    const now = Date.now();
    if (now - this.lastEmoteAt < 1200) {
      this.ui.toast("发送太快了");
      return;
    }
    this.lastEmoteAt = now;
    if (this.offline) {
      this.ui.showEmote(this.ui.playerName(), id);
      this.ui.addChatEntry({
        name: this.ui.playerName(),
        text: id,
        isEmote: true,
        mine: true,
      });
      return;
    }
    if (!this.net.room) {
      this.ui.toast("未连接房间");
      return;
    }
    this.net.emote(id);
  }

  private sendChat(text: string): void {
    const msg = text.trim().slice(0, 200);
    if (!msg) return;
    const now = Date.now();
    if (now - this.lastChatAt < 1200) {
      this.ui.toast("发送太快了");
      return;
    }
    if (this.offline) {
      this.lastChatAt = now;
      this.ui.clearChatInput();
      this.ui.addChatEntry({
        name: this.ui.playerName(),
        text: msg,
        isEmote: false,
        mine: true,
      });
      return;
    }
    if (!this.net.room) {
      this.ui.toast("未连接房间");
      return;
    }
    this.lastChatAt = now;
    this.ui.clearChatInput();
    this.net.chat(msg);
  }

  private send(cardId: number, targetId?: number): void {
    if (this.offline) {
      this.offline.play(cardId, targetId);
      this.offline.hand = this.offline.hand.filter((c) => c !== cardId);
      this.hand = this.offline.hand.slice();
    } else {
      this.net.play(cardId, targetId);
      this.net.hand = this.net.hand.filter((c) => c !== cardId);
      this.hand = this.net.hand.slice();
    }
    this.selected = -1;
    this.discardArmed = -1;
    this.targets = [];
    this.hintText = "";
    this.render();
  }

  private drawFelt(): void {
    const g = this.feltNode.addComponent(Graphics);
    const w = DESIGN.width;
    const h = DESIGN.height;
    this.feltNode.addComponent(UITransform).setContentSize(new Size(w, h));
    this.feltNode.on(Node.EventType.TOUCH_END, () => this.clearSelection());

    g.fillColor = C.feltInner;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();

    g.lineWidth = 2;
    g.strokeColor = new Color(201, 169, 97, 72);
    g.roundRect(-w / 2 + 26, -h / 2 + 26, w - 52, h - 52, 18);
    g.stroke();

    g.lineWidth = 3;
    g.strokeColor = new Color(201, 169, 97, 128);
    const c = 34;
    const corners: [number, number, number, number][] = [
      [-w / 2 + 40, h / 2 - 40, 1, -1],
      [w / 2 - 40, h / 2 - 40, -1, -1],
      [-w / 2 + 40, -h / 2 + 40, 1, 1],
      [w / 2 - 40, -h / 2 + 40, -1, 1],
    ];
    for (const [x, y, sx, sy] of corners) {
      g.moveTo(x, y + sy * c);
      g.lineTo(x, y);
      g.lineTo(x + sx * c, y);
      g.stroke();
    }
  }

  private clearSelection(): void {
    if (this.selected < 0 && this.discardArmed < 0) return;
    this.selected = -1;
    this.discardArmed = -1;
    this.targets = [];
    this.hintText = "";
    this.render();
  }
}
