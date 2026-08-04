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
} from "cc";
import { createCard, addLabel, loadCardAtlas } from "./CardNode";
import {
  findTargets,
  cardScore,
  MATCH_HOLD_S,
  ROUND_RESULT_AUTO_MS,
  type GameEvent,
} from "./rules";
import { Net, type RoundOver } from "./Net";
import { LobbyUI } from "./LobbyUI";
import { C, DESIGN, HAND_W, TABLE_CARD_W, CARD_RATIO } from "./Theme";

const { ccclass } = _decorator;

/**
 * 牌桌入口：纯代码建节点。
 * 渲染与出牌均由服务器状态驱动（Net），大厅/房间/结算由 LobbyUI 承担。
 */
@ccclass("GameEntry")
export class GameEntry extends Component {
  net = new Net();
  private ui!: LobbyUI;
  private hand: number[] = [];
  private selected = -1;
  private discardArmed = -1;
  private targets: number[] = [];
  private lastRound: RoundOver | null = null;
  private hintText = "";
  private tableVisible = false;
  private matchBusy = false;
  private aiDifficulty: "easy" | "normal" | "hard" = "normal";

  private feltNode!: Node;
  private tableNode!: Node;
  private handNode!: Node;
  private deckNode!: Node;
  private infoNode!: Node;
  private matchNode!: Node;

  start(): void {
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
      onEmote: (id) => this.net.emote(id),
      onReady: () => {
        const me = this.net.state?.players.get(this.net.room!.sessionId);
        this.net.ready(!me?.ready);
      },
      onAddAi: () => this.net.addAi(this.aiDifficulty),
      onAiDifficulty: (d) => {
        this.aiDifficulty = d;
      },
      onQuit: () => this.guard(() => this.doQuit()),
      onAgain: () => {
        this.net.nextRound();
        this.lastRound = null;
        this.ui.show("room");
      },
      onExit: () => this.guard(() => this.doQuit()),
    });

    void loadCardAtlas().then((ok) => {
      if (ok) console.log("[card] 位图图集已加载");
    });

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
    await this.net.quickMatch(name, maxPlayers);
    this.net.ready(true);
    this.ui.show("room");
  }

  private async doCreate(
    name: string,
    maxPlayers: number,
    withAi = false
  ): Promise<void> {
    await this.net.create(name, maxPlayers);
    if (withAi) this.net.addAi();
    this.ui.show("room");
  }

  private async doJoin(name: string, code: string): Promise<void> {
    await this.net.joinByCode(name, code);
    this.ui.show("room");
  }

  private async doSpectate(name: string, code: string): Promise<void> {
    await this.net.spectateByCode(name, code);
    this.ui.toast("已进入观战");
    this.setTableVisible(true);
    this.ui.show("none");
    this.ui.setEmotesVisible(true);
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
    await this.net.leave();
    this.resetLocal();
    this.setTableVisible(false);
    this.ui.show("lobby");
  }

  async joinByCode(name: string, code: string): Promise<void> {
    await this.net.leave().catch(() => undefined);
    this.resetLocal();
    await this.net.joinByCode(name, code);
    this.net.ready(true);
    this.ui.show("room");
  }

  async createHost(
    name: string,
    maxPlayers: number,
    withAi = false
  ): Promise<string> {
    await this.net.leave().catch(() => undefined);
    this.resetLocal();
    await this.net.create(name, maxPlayers);
    if (withAi) this.net.addAi();
    const code = await this.waitCode();
    this.net.ready(true);
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
  }

  private bindNet(): void {
    this.net.onState = (state) => {
      this.hand = this.net.hand.slice();
      if (state.phase === "WAITING") {
        this.setTableVisible(false);
        this.ui.setEmotesVisible(false);
        this.ui.renderRoom(state, this.net.room!.sessionId);
        if (!this.lastRound) this.ui.show("room");
      } else if (state.phase === "PLAYING") {
        this.setTableVisible(true);
        this.ui.show("none");
        this.ui.setEmotesVisible(true);
        this.syncSelection();
        this.hintText = this.net.spectating
          ? "观战中"
          : this.myTurn()
            ? state.turnPhase === "CHOOSE_STOCK_TARGET"
              ? "翻牌可吃，请选择目标"
              : "轮到你出牌"
            : "对手出牌中…";
      } else if (state.phase === "ROUND_OVER" && this.lastRound) {
        this.ui.setEmotesVisible(false);
        this.ui.renderResult(this.lastRound, state, this.net.mySeat);
        this.ui.show("result");
      }
      if (this.tableVisible && !this.matchBusy) this.render();
    };

    this.net.onRoundStart = () => {
      this.selected = -1;
      this.discardArmed = -1;
      this.targets = [];
      this.lastRound = null;
      this.hand = this.net.hand.slice();
      this.hintText = "新一轮开始";
      this.setTableVisible(true);
      this.ui.show("none");
      this.render();
    };

    this.net.onEvents = (events: GameEvent[]) => {
      this.hand = this.net.hand.slice();
      const capture = events.find((e) => e.target !== undefined);
      if (capture && capture.target !== undefined) {
        this.playMatch(capture.card, capture.target);
        return;
      }
      if (this.tableVisible && !this.matchBusy) this.render();
    };

    this.net.onRoundOver = (r) => {
      this.lastRound = r;
      const show = () => {
        if (this.net.state) {
          this.ui.renderResult(r, this.net.state, this.net.mySeat);
          this.ui.show("result");
        }
        if (!r.allDone) {
          setTimeout(() => {
            if (this.lastRound === r && !r.allDone) this.ui.show("none");
          }, ROUND_RESULT_AUTO_MS);
        }
      };
      setTimeout(show, 200);
    };

    this.net.onError = (msg) => {
      this.ui.toast(msg);
      this.selected = -1;
      this.discardArmed = -1;
      this.syncSelection();
      if (this.tableVisible) this.render();
    };

    this.net.onEmote = (e) => {
      this.ui.toast(`${e.name}：${e.id}`);
    };

    this.net.onLeave = () => {
      if (this.lastRound) return;
      this.ui.toast("已断开连接");
      this.setTableVisible(false);
      this.ui.show("lobby");
    };
  }

  private playMatch(cardId: number, targetId: number): void {
    this.matchBusy = true;
    this.unschedule(this.clearMatch);
    this.matchNode.removeAllChildren();
    this.matchNode.active = true;

    const gain = cardScore(cardId) + cardScore(targetId);
    const w = TABLE_CARD_W * 1.3;
    const h = w * CARD_RATIO;
    const left = createCard(cardId, w);
    const right = createCard(targetId, w);
    left.setPosition(new Vec3(-w - 10, h / 2, 0));
    right.setPosition(new Vec3(10, h / 2, 0));
    this.matchNode.addChild(left);
    this.matchNode.addChild(right);
    addLabel(
      this.matchNode,
      gain > 0 ? `MATCH! +${gain}` : "MATCH!",
      0,
      h / 2 + 36,
      28,
      C.gold,
      true
    );

    this.render();
    this.scheduleOnce(this.clearMatch, MATCH_HOLD_S);
  }

  private clearMatch = (): void => {
    this.matchNode.removeAllChildren();
    this.matchNode.active = false;
    this.matchBusy = false;
    if (this.tableVisible) this.render();
  };

  private myTurn(): boolean {
    if (this.net.spectating) return false;
    const s = this.net.state;
    return !!s && s.phase === "PLAYING" && s.currentSeat === this.net.mySeat;
  }

  private syncSelection(): void {
    const state = this.net.state;
    if (!state) {
      this.targets = [];
      return;
    }
    if (
      state.turnPhase === "CHOOSE_STOCK_TARGET" &&
      state.currentSeat === this.net.mySeat
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
    const n = (this.net.state?.stockCount as number) ?? 0;
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
    const table: number[] = this.net.state ? [...this.net.state.table] : [];
    if (!table.length) return;
    const cols = Math.min(9, Math.max(1, table.length));
    const gap = 12;
    const rows = Math.ceil(table.length / cols);
    const rowH = TABLE_CARD_W * CARD_RATIO + gap;
    const totalH = rows * rowH - gap;
    const startY = totalH / 2;
    const choosing =
      this.net.state?.turnPhase === "CHOOSE_STOCK_TARGET" && this.myTurn();

    table.forEach((id, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, table.length - row * cols);
      const rowW = inRow * TABLE_CARD_W + (inRow - 1) * gap;
      const startX = -rowW / 2;
      const isTarget = this.targets.indexOf(id) >= 0;
      const card = createCard(id, TABLE_CARD_W, {
        highlight: isTarget,
        dim: (this.selected >= 0 || choosing) && !isTarget,
      });
      const x = startX + (i % cols) * (TABLE_CARD_W + gap);
      const y = startY - row * rowH;
      card.setPosition(new Vec3(x, y, 0));
      if (isTarget) {
        card
          .addComponent(UITransform)
          .setContentSize(new Size(TABLE_CARD_W, TABLE_CARD_W * CARD_RATIO));
        card.on(Node.EventType.TOUCH_END, () => this.onPickTable(id));
      }
      this.tableNode.addChild(card);
    });
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
      this.myTurn() && this.net.state?.turnPhase === "PLAY_HAND";

    this.hand.forEach((id, i) => {
      const k = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
      const lift = this.selected === id ? 22 : 0;
      const card = createCard(id, HAND_W, {
        selected: this.selected === id,
        dim: !canPlay,
      });
      card.setPosition(
        new Vec3(startX + i * step, baseY - k * k * 10 + lift, 0)
      );
      card.on(Node.EventType.TOUCH_END, () => this.onPickHand(id));
      this.handNode.addChild(card);
    });
  }

  private renderInfo(): void {
    this.infoNode.removeAllChildren();
    const state = this.net.state;
    const players = state ? ([...state.players.values()] as any[]) : [];
    const me = players.find((p) => p.seat === this.net.mySeat);
    const others = players.filter((p) => p.seat !== this.net.mySeat);
    const myPts = me?.points ?? 0;
    const otherTxt = others
      .map((p) => `${p.name}${p.isAi ? "(AI)" : ""} ${p.points}分`)
      .join(" | ");
    const code = state?.code ? `房 ${state.code}` : "";
    const text = `${code}  我 ${myPts}分${otherTxt ? " | " + otherTxt : ""}  余 ${this.hand.length}张`;
    addLabel(this.infoNode, text, 0, DESIGN.height / 2 - 40, 20, C.cream, true);

    if (this.hintText && !this.lastRound) {
      addLabel(
        this.infoNode,
        this.hintText,
        0,
        -DESIGN.height / 2 + HAND_W * CARD_RATIO + 70,
        18,
        C.seal,
        true
      );
    }
  }

  onPickHand(id: number): void {
    if (!this.myTurn() || this.net.state?.turnPhase !== "PLAY_HAND") return;
    const targets = findTargets(id, [...this.net.state.table]);

    if (targets.length === 1) return this.send(id, targets[0]);
    if (targets.length === 0) {
      if (this.discardArmed === id) return this.send(id);
      this.discardArmed = id;
      this.selected = id;
      this.targets = [];
      this.hintText = "该牌无可吃目标，再点一次确认打出";
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
    if (!this.myTurn()) return;
    if (this.net.state.turnPhase === "CHOOSE_STOCK_TARGET") {
      if (this.targets.indexOf(id) >= 0) this.net.chooseTarget(id);
      return;
    }
    if (this.selected < 0 || this.targets.indexOf(id) < 0) return;
    this.send(this.selected, id);
  }

  private send(cardId: number, targetId?: number): void {
    this.net.play(cardId, targetId);
    this.net.hand = this.net.hand.filter((c) => c !== cardId);
    this.hand = this.net.hand.slice();
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
}
