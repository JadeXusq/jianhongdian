import {
  Node,
  UITransform,
  Graphics,
  Label,
  Color,
  Vec3,
  Layers,
  Size,
  EditBox,
  Mask,
  ScrollView,
} from "cc";
import { C, DESIGN } from "./Theme";
import type { RoundOver } from "./Net";

export type UiScreen =
  | "lobby"
  | "room"
  | "result"
  | "account"
  | "guide"
  | "rules"
  | "menu"
  | "scores"
  | "settle-confirm"
  | "room-code"
  | "none";

export interface LobbyCallbacks {
  onMatch(name: string, maxPlayers: number): void;
  onCreate(name: string, maxPlayers: number): void;
  onJoin(name: string, code: string): void;
  onSpectate(name: string, code: string): void;
  onPractice(name: string, maxPlayers: number): void;
  onAccount(): void;
  onAccCreate(name: string): void;
  onAccBind(accountId: string, token: string): void;
  onEmote(id: string): void;
  onChat(text: string): void;
  onReady(): void;
  onAddAi(): void;
  onQuit(): void;
  onAgain(): void;
  onExit(): void;
  onGuideOk(): void;
  onRulesClose(): void;
  onOpenRules(from: UiScreen): void;
  onMenuScores(): void;
  onMenuSettle(): void;
  onMenuRestart(): void;
  isHost(): boolean;
  canSettleMatch(): boolean;
  canRestartMatch(): boolean;
}

/** 大厅 / 房间等待 / 结算 / 引导 / 规则覆盖层 */
export class LobbyUI {
  root: Node;
  private lobby!: Node;
  private room!: Node;
  private result!: Node;
  private account!: Node;
  private guide!: Node;
  private rules!: Node;
  private menu!: Node;
  private scores!: Node;
  private settleConfirm!: Node;
  private roomCodeDialog!: Node;
  private emotes!: Node;
  private chatPanel!: Node;
  private chatToggle!: Node;
  private chatUnreadLbl!: Label;
  private chatLogLbl!: Label;
  private chatInput!: EditBox;
  private chatLog: Array<{
    name: string;
    text: string;
    isEmote: boolean;
    mine: boolean;
  }> = [];
  private chatUnread = 0;
  private helpBtn!: Node;
  private menuBtn!: Node;
  private settleBtn!: Node;
  private resultSettleBtn!: Node;
  private resultRestartBtn!: Node;
  private againBtn!: Node;
  private scoresList!: Node;
  private scoresRound!: Label;
  private emoteBubble!: Label;
  private emoteTimer = 0;
  private nameBox!: EditBox;
  private codeBox!: EditBox;
  private roomCodeTitle!: Label;
  private roomCodeMode: "join" | "spectate" = "join";
  private accIdBox!: EditBox;
  private accTokenBox!: EditBox;
  private accStatusLbl!: Label;
  private accHintLbl!: Label;
  private count = 4;
  private countLabels: Label[] = [];
  private roomCodeLbl!: Label;
  private roomStatusLbl!: Label;
  private seatsNode!: Node;
  private readyLbl!: Label;
  private aiBtn!: Node;
  private resultTitle!: Label;
  private resultDots!: Node;
  private resultList!: Node;
  private againLbl!: Label;
  private exitBtn!: Node;
  private toastLbl!: Label;
  private toastTimer = 0;
  private settleBack: UiScreen = "menu";
  private rulesBack: UiScreen = "lobby";

  constructor(
    private parent: Node,
    private cb: LobbyCallbacks
  ) {
    this.root = new Node("LobbyUI");
    this.root.layer = Layers.Enum.UI_2D;
    parent.addChild(this.root);
    this.root.addComponent(UITransform).setContentSize(
      new Size(DESIGN.width, DESIGN.height)
    );

    this.lobby = this.buildLobby();
    this.room = this.buildRoom();
    this.result = this.buildResult();
    this.account = this.buildAccount();
    this.guide = this.buildGuide();
    this.rules = this.buildRules();
    this.menu = this.buildMenu();
    this.scores = this.buildScores();
    this.settleConfirm = this.buildSettleConfirm();
    this.roomCodeDialog = this.buildRoomCodeDialog();
    this.emotes = this.buildEmotes();
    this.chatPanel = this.buildChatPanel();
    this.chatToggle = this.buildChatToggle();
    this.menuBtn = this.makeBtn(
      this.root,
      "菜单",
      -DESIGN.width / 2 + 50,
      DESIGN.height / 2 - 36,
      72,
      36,
      () => this.openMenu()
    );
    this.menuBtn.active = false;
    this.helpBtn = this.makeBtn(
      this.root,
      "?",
      DESIGN.width / 2 - 70,
      DESIGN.height / 2 - 36,
      36,
      36,
      () => this.openRules(this.result.active ? "result" : "none")
    );
    this.helpBtn.active = false;
    this.emoteBubble = this.makeLabel(
      this.root,
      "",
      0,
      DESIGN.height / 2 - 160,
      26,
      C.gold
    );
    this.emoteBubble.node.active = false;
    this.toastLbl = this.makeLabel(
      this.root,
      "",
      0,
      -DESIGN.height / 2 + 60,
      20,
      C.cream
    );
    this.toastLbl.node.active = false;
    this.show("lobby");
  }

  show(screen: UiScreen): void {
    this.lobby.active = screen === "lobby";
    this.room.active = screen === "room";
    this.result.active = screen === "result";
    this.account.active = screen === "account";
    this.guide.active = screen === "guide";
    this.rules.active = screen === "rules";
    this.menu.active = screen === "menu";
    this.scores.active = screen === "scores";
    this.settleConfirm.active = screen === "settle-confirm";
    this.roomCodeDialog.active = screen === "room-code";
    if (screen !== "none") {
      this.setEmotesVisible(false);
      this.setChatPanelOpen(false);
    }
  }

  setEmotesVisible(v: boolean): void {
    this.emotes.active = v;
  }

  setChatToggleVisible(v: boolean): void {
    this.chatToggle.active = v;
    if (!v) this.setChatPanelOpen(false);
  }

  setChatPanelOpen(open: boolean): void {
    this.chatPanel.active = open;
    if (open) {
      this.chatUnread = 0;
      this.updateChatBadge();
      this.renderChatLog();
    }
  }

  isChatOpen(): boolean {
    return this.chatPanel.active;
  }

  clearChatLog(): void {
    this.chatLog.length = 0;
    this.chatUnread = 0;
    this.renderChatLog();
    this.updateChatBadge();
    this.setChatPanelOpen(false);
  }

  addChatEntry(e: {
    name: string;
    text: string;
    isEmote: boolean;
    mine: boolean;
  }): void {
    this.chatLog.push(e);
    if (this.chatLog.length > 200) this.chatLog.shift();
    if (!e.mine && !this.isChatOpen()) this.chatUnread += 1;
    this.renderChatLog();
    this.updateChatBadge();
  }

  private updateChatBadge(): void {
    const badge = this.chatUnreadLbl.node.parent;
    if (!badge) return;
    if (this.chatUnread <= 0) {
      badge.active = false;
      this.chatUnreadLbl.string = "0";
      return;
    }
    this.chatUnreadLbl.string =
      this.chatUnread > 99 ? "99+" : String(this.chatUnread);
    badge.active = true;
  }

  clearChatInput(): void {
    this.chatInput.string = "";
  }

  private renderChatLog(): void {
    const icons: Record<string, string> = {
      加油: "💪",
      好牌: "👏",
      厉害: "👍",
      等等: "⏳",
      哈哈哈: "😄",
    };
    const lines = this.chatLog.map((e) => {
      const mark = e.mine ? "▶" : "";
      if (e.isEmote) {
        const icon = icons[e.text] ?? "💬";
        return `${mark}${e.name}：${icon} ${e.text}`;
      }
      return `${mark}${e.name}：${e.text}`;
    });
    this.chatLogLbl.string = lines.join("\n") || "暂无消息";
  }

  setHelpVisible(v: boolean): void {
    this.helpBtn.active = v;
  }

  setMenuVisible(v: boolean): void {
    this.menuBtn.active = v;
    if (v) this.setChatPanelOpen(false);
  }

  isOverlay(): boolean {
    return (
      this.guide.active ||
      this.rules.active ||
      this.menu.active ||
      this.scores.active ||
      this.settleConfirm.active
    );
  }

  private openMenu(): void {
    this.settleBtn.active = this.cb.canSettleMatch();
    this.setChatPanelOpen(false);
    this.show("menu");
  }

  openRules(from: UiScreen = "lobby"): void {
    this.rulesBack = from;
    this.setChatPanelOpen(false);
    this.show("rules");
    this.setHelpVisible(false);
    this.cb.onOpenRules(from);
  }

  private closeRules(): void {
    const back = this.rulesBack;
    this.show(back);
    this.cb.onRulesClose();
  }

  renderScores(state: any, mySeat: number): void {
    const players = [...state.players.values()] as any[];
    const rows = [...players].sort((a, b) => b.totalNet - a.totalNet);
    this.scoresRound.string = state.round
      ? `已完成 ${state.round} 轮 · 累计净分`
      : "尚未完成轮次";
    this.scoresList.removeAllChildren();
    rows.forEach((p, i) => {
      const mark = p.seat === mySeat ? " ▶" : "";
      const net =
        (p.totalNet > 0 ? "+" : "") + p.totalNet;
      this.makeLabel(
        this.scoresList,
        `${i + 1}. ${p.name}${
          p.isAi && !String(p.name).startsWith("机器人") ? "〔机〕" : ""
        }${mark}  本轮${p.points}  总${net}`,
        0,
        50 - i * 36,
        18,
        p.seat === mySeat ? C.gold : C.cream
      );
    });
    this.show("scores");
  }

  setAccountStatus(status: string, hint = ""): void {
    this.accStatusLbl.string = status;
    this.accHintLbl.string = hint;
  }

  toast(msg: string, ms = 2200): void {
    this.toastLbl.string = msg;
    this.toastLbl.node.active = true;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastLbl.node.active = false;
    }, ms) as unknown as number;
  }

  showEmote(name: string, id: string): void {
    const icons: Record<string, string> = {
      加油: "💪",
      好牌: "👏",
      厉害: "👍",
      等等: "⏳",
      哈哈哈: "😄",
    };
    const icon = icons[id] ?? "💬";
    this.emoteBubble.string = `${icon} ${name}：${id}`;
    this.emoteBubble.node.active = true;
    clearTimeout(this.emoteTimer);
    this.emoteTimer = setTimeout(() => {
      this.emoteBubble.node.active = false;
    }, 2800) as unknown as number;
  }

  playerName(): string {
    const raw = (this.nameBox.string || "").trim().slice(0, 10);
    this.nameBox.string = raw;
    const v = raw || "无名客";
    try {
      localStorage.setItem("jhd.name", raw);
    } catch {
      /* ignore */
    }
    return v;
  }

  renderRoom(state: any, mySessionId: string): void {
    this.roomCodeLbl.string = state.code || "------";
    this.seatsNode.removeAllChildren();
    const players: Array<{
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
      players.push({
        sessionId,
        name: String(p.name || "玩家"),
        seat: Number(p.seat) || 0,
        isAi: !!p.isAi,
        ready: !!p.ready,
      });
    });
    players.sort((a, b) => a.seat - b.seat);
    const bySeat = new Map(players.map((p) => [p.seat, p]));
    const nameCount = new Map<string, number>();
    for (const p of players)
      nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);

    const startY = 70;
    for (let i = 0; i < state.maxPlayers; i++) {
      const p = bySeat.get(i);
      let line = `座位 ${i + 1}  空`;
      if (p) {
        const dup = (nameCount.get(p.name) ?? 0) > 1;
        const label = dup ? `${p.name}·座${i + 1}` : p.name;
        line = `${label}${
          p.isAi && !String(p.name).startsWith("机器人") ? "〔机〕" : ""
        }${
          p.sessionId === mySessionId ? "（我）" : ""
        }  ${p.ready ? "已准备" : "等待中"}`;
      }
      this.makeLabel(
        this.seatsNode,
        line,
        0,
        startY - i * 36,
        22,
        p ? C.cream : C.goldDim
      );
    }

    const need = state.maxPlayers - players.length;
    const unready = players.filter((p) => !p.ready).length;
    if (this.roomStatusLbl) {
      this.roomStatusLbl.string =
        need > 0
          ? `还差 ${need} 人（可添加机器人）`
          : unready > 0
            ? `人数已满 · 还有 ${unready} 人未准备`
            : "全员已准备 · 即将开局";
    }

    const me = players.find((x) => x.sessionId === mySessionId);
    this.readyLbl.string = me?.ready ? "取消准备" : "准备";
    const isHost = state.hostSessionId === mySessionId;
    this.aiBtn.active = isHost && players.length < state.maxPlayers;
  }

  renderResult(
    r: RoundOver,
    state: any,
    mySeat: number,
    againAllDone = "再来一局"
  ): void {
    const players = [...state.players.values()] as any[];
    const rows = players
      .map((p) => ({ p, points: r.points[p.seat], net: r.net[p.seat] }))
      .sort((a, b) => b.net - a.net);
    const winner = rows[0];
    const iWin = winner?.p.seat === mySeat && winner.net >= 0;
    this.resultTitle.string = r.allDone
      ? iWin
        ? "最终结算 · 胜"
        : `最终结算（${r.round} 轮）`
      : `第 ${r.round} 轮`;

    this.resultDots.removeAllChildren();
    const dotN = r.allDone ? Math.max(1, r.round) : 1;
    for (let i = 0; i < dotN; i++) {
      const d = new Node("Dot");
      d.layer = Layers.Enum.UI_2D;
      this.resultDots.addChild(d);
      d.setPosition(new Vec3((i - (dotN - 1) / 2) * 18, 0, 0));
      const g = d.addComponent(Graphics);
      g.fillColor = C.gold;
      g.circle(0, 0, 5);
      g.fill();
      g.strokeColor = C.goldDim;
      g.lineWidth = 1;
      g.circle(0, 0, 5);
      g.stroke();
    }

    this.resultList.removeAllChildren();
    rows.forEach((row, i) => {
      const mark = row.p.seat === mySeat ? " ▶" : "";
      const rank = i === 0 ? "胜" : `${i + 1}`;
      const net =
        (row.net > 0 ? "+" : "") +
        row.net +
        (r.allDone ? ` | 总 ${row.p.totalNet}` : ` | 总 ${row.p.totalNet}`);
      this.makeLabel(
        this.resultList,
        `${rank}. ${row.p.name}${
          row.p.isAi && !String(row.p.name).startsWith("机器人") ? "〔机〕" : ""
        }${mark}  ${row.points}分  ${net}`,
        0,
        50 - i * 36,
        20,
        row.p.seat === mySeat ? C.gold : C.cream
      );
    });
    this.againLbl.string = r.allDone
      ? againAllDone
      : "继续下一轮";
    this.exitBtn.active = !!r.allDone;
    this.resultSettleBtn.active = !r.allDone && this.cb.canSettleMatch();
    this.resultRestartBtn.active = !r.allDone && this.cb.canRestartMatch();
    if (r.allDone) {
      this.againBtn.setPosition(new Vec3(0, -195, 0));
      this.exitBtn.setPosition(new Vec3(0, -140, 0));
      this.paintBtn(this.againBtn, true);
    } else {
      this.againBtn.setPosition(new Vec3(0, this.resultRestartBtn.active ? -95 : -140, 0));
      this.resultRestartBtn.setPosition(new Vec3(0, -140, 0));
      this.resultSettleBtn.setPosition(new Vec3(0, -195, 0));
      this.paintBtn(this.againBtn, false);
    }
  }

  private buildLobby(): Node {
    const panel = this.panel("Lobby", 400, 560);
    this.makeLabel(panel, "捡红点", 0, 210, 38, C.gold);
    this.makeLabel(panel, "出手牌凑十吃红分 · 红鬼最大", 0, 168, 15, C.cream);

    this.makeLabel(panel, "昵称", -130, 118, 17, C.goldDim);
    this.nameBox = this.makeEdit(panel, 0, 113, 250, 38, "请输入昵称");
    try {
      this.nameBox.string = localStorage.getItem("jhd.name") || "";
    } catch {
      /* ignore */
    }

    this.makeLabel(panel, "人数", -130, 62, 17, C.goldDim);
    [2, 3, 4].forEach((n, i) => {
      const x = -80 + i * 90;
      const btn = this.makeBtn(panel, `${n} 人`, x, 58, 78, 34, () => {
        this.count = n;
        this.countLabels.forEach((l, j) => {
          l.color = j === i ? C.seal : C.cream;
        });
      });
      const lbl = btn.getComponentInChildren(Label)!;
      this.countLabels.push(lbl);
      if (n === 4) lbl.color = C.seal;
    });

    this.makeBtn(panel, "人机练习（离线）", 0, -10, 270, 42, () =>
      this.cb.onPractice(this.playerName(), this.count)
    );
    this.makeBtn(panel, "快速匹配", 0, -60, 270, 40, () =>
      this.cb.onMatch(this.playerName(), this.count)
    );
    this.makeBtn(panel, "创建房间", -75, -112, 125, 38, () =>
      this.cb.onCreate(this.playerName(), this.count)
    );
    this.makeBtn(panel, "输房号加入", 75, -112, 125, 38, () =>
      this.openRoomCodeDialog("join")
    );
    this.makeBtn(panel, "房号观战", -75, -160, 125, 36, () =>
      this.openRoomCodeDialog("spectate")
    );
    this.makeBtn(panel, "账号绑定", 75, -160, 125, 36, () =>
      this.cb.onAccount()
    );
    this.makeBtn(panel, "查看规则", 0, -215, 120, 30, () =>
      this.openRules("lobby")
    );
    return panel;
  }

  private buildRoomCodeDialog(): Node {
    const panel = this.panel("RoomCodeDialog", 300, 270);
    this.roomCodeTitle = this.makeLabel(panel, "加入房间", 0, 90, 24, C.gold);
    this.makeLabel(panel, "房号", -105, 35, 16, C.goldDim);
    this.codeBox = this.makeEdit(panel, 20, 30, 190, 36, "请输入6位房号");
    this.codeBox.inputMode = EditBox.InputMode.NUMERIC;
    this.codeBox.maxLength = 6;
    this.makeBtn(panel, "取消", 0, -35, 180, 38, () =>
      this.show("lobby")
    );
    this.makeBtn(
      panel,
      "确认",
      0,
      -85,
      180,
      40,
      () => this.submitRoomCode(),
      true
    );
    return panel;
  }

  private openRoomCodeDialog(mode: "join" | "spectate"): void {
    this.roomCodeMode = mode;
    this.roomCodeTitle.string = mode === "join" ? "加入房间" : "观战房间";
    this.codeBox.string = "";
    this.show("room-code");
    this.codeBox.focus();
  }

  private submitRoomCode(): void {
    const code = (this.codeBox.string || "").replace(/\D/g, "").slice(0, 6);
    this.codeBox.string = code;
    if (code.length !== 6) {
      this.toast("请输入6位房号");
      this.codeBox.focus();
      return;
    }
    if (this.roomCodeMode === "join") {
      this.cb.onJoin(this.playerName(), code);
      return;
    }
    this.cb.onSpectate(this.playerName(), code);
  }

  private buildAccount(): Node {
    const panel = this.panel("Account", 440, 400);
    this.makeLabel(panel, "本地账号", 0, 150, 28, C.gold);
    this.accStatusLbl = this.makeLabel(
      panel,
      "未绑定",
      0,
      100,
      16,
      C.cream
    );
    this.makeLabel(panel, "账号ID", -150, 50, 16, C.goldDim);
    this.accIdBox = this.makeEdit(panel, 40, 45, 220, 36, "accountId");
    this.makeLabel(panel, "凭证", -150, 0, 16, C.goldDim);
    this.accTokenBox = this.makeEdit(panel, 40, -5, 220, 36, "token");
    this.makeBtn(panel, "绑定已有", 0, -60, 180, 40, () => {
      const id = (this.accIdBox.string || "").trim();
      const tok = (this.accTokenBox.string || "").trim();
      if (!id || !tok) {
        this.toast("请填写账号与凭证");
        return;
      }
      this.cb.onAccBind(id, tok);
    });
    this.makeBtn(panel, "返回", 0, -95, 180, 36, () => this.show("lobby"));
    this.accHintLbl = this.makeLabel(panel, "", 0, -128, 14, C.goldDim);
    this.makeBtn(
      panel,
      "创建并绑定",
      0,
      -170,
      180,
      40,
      () => this.cb.onAccCreate(this.playerName()),
      true
    );
    return panel;
  }

  private buildEmotes(): Node {
    const bar = new Node("Emotes");
    bar.layer = Layers.Enum.UI_2D;
    this.root.addChild(bar);
    // 右侧竖排，避开底部手牌点击区
    bar.setPosition(new Vec3(DESIGN.width / 2 - 56, -DESIGN.height / 2 + 170, 0));
    const list = ["加油", "好牌", "厉害", "等等", "哈哈哈"];
    list.forEach((text, i) => {
      this.makeBtn(bar, text, 0, i * 38, 88, 32, () => this.cb.onEmote(text));
    });
    bar.active = false;
    return bar;
  }

  private buildChatToggle(): Node {
    const btn = this.makeBtn(
      this.root,
      "💬",
      DESIGN.width / 2 - 50,
      DESIGN.height / 2 - 90,
      36,
      36,
      () => this.setChatPanelOpen(!this.isChatOpen())
    );
    const badge = new Node("Unread");
    badge.layer = Layers.Enum.UI_2D;
    btn.addChild(badge);
    badge.setPosition(new Vec3(14, 14, 0));
    badge.addComponent(UITransform).setContentSize(new Size(18, 18));
    const g = badge.addComponent(Graphics);
    g.fillColor = C.seal;
    g.circle(0, 0, 9);
    g.fill();
    this.chatUnreadLbl = this.makeLabel(badge, "0", 0, 0, 10, C.cream);
    badge.active = false;
    btn.active = false;
    return btn;
  }

  private buildChatPanel(): Node {
    const panel = this.panel("Chat", 320, 360);
    panel.setPosition(new Vec3(DESIGN.width / 2 - 180, 20, 0));
    this.makeCloseX(panel, () => this.setChatPanelOpen(false));
    this.makeLabel(panel, "聊天记录", 0, 150, 20, C.gold);

    const viewport = new Node("ChatViewport");
    viewport.layer = Layers.Enum.UI_2D;
    panel.addChild(viewport);
    viewport.setPosition(new Vec3(0, 20, 0));
    viewport.addComponent(UITransform).setContentSize(new Size(290, 220));
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;

    const content = new Node("ChatContent");
    content.layer = Layers.Enum.UI_2D;
    viewport.addChild(content);
    content.addComponent(UITransform).setContentSize(new Size(280, 220));
    content.setPosition(new Vec3(0, 0, 0));

    this.chatLogLbl = this.makeLabel(content, "暂无消息", 0, 0, 13, C.cream);
    this.chatLogLbl.overflow = Label.Overflow.RESIZE_HEIGHT;
    this.chatLogLbl.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.chatLogLbl.verticalAlign = Label.VerticalAlign.TOP;
    const logUt = this.chatLogLbl.node.getComponent(UITransform)!;
    logUt.setContentSize(new Size(270, 220));

    const scroll = viewport.addComponent(ScrollView);
    scroll.content = content;
    scroll.horizontal = false;
    scroll.vertical = true;

    this.chatInput = this.makeEdit(panel, -40, -140, 200, 34, "说点什么…");
    this.makeBtn(panel, "发送", 110, -140, 70, 34, () => {
      const text = (this.chatInput.string || "").trim().slice(0, 200);
      if (!text) return;
      this.cb.onChat(text);
    });
    panel.active = false;
    return panel;
  }

  private buildRoom(): Node {
    const panel = this.panel("Room", 420, 500);
    this.makeLabel(panel, "房间等待", 0, 210, 28, C.gold);
    this.roomCodeLbl = this.makeLabel(panel, "------", 0, 165, 36, C.seal);
    this.roomStatusLbl = this.makeLabel(
      panel,
      "等待玩家加入",
      0,
      125,
      16,
      C.goldDim
    );
    this.seatsNode = new Node("Seats");
    this.seatsNode.layer = Layers.Enum.UI_2D;
    panel.addChild(this.seatsNode);

    this.aiBtn = this.makeBtn(panel, "＋ 添加机器人", -90, -150, 150, 40, () =>
      this.cb.onAddAi()
    );
    const readyBtn = this.makeBtn(
      panel,
      "准备",
      90,
      -150,
      120,
      40,
      () => this.cb.onReady(),
      true
    );
    this.readyLbl = readyBtn.getComponentInChildren(Label)!;
    this.makeBtn(panel, "离开房间", 0, -205, 160, 36, () => this.cb.onQuit());
    return panel;
  }

  private buildResult(): Node {
    const panel = this.panel("Result", 440, 460);
    this.resultTitle = this.makeLabel(panel, "本局结算", 0, 170, 28, C.gold);
    this.resultDots = new Node("Dots");
    this.resultDots.layer = Layers.Enum.UI_2D;
    panel.addChild(this.resultDots);
    this.resultDots.setPosition(new Vec3(0, 130, 0));
    this.resultList = new Node("ResultList");
    this.resultList.layer = Layers.Enum.UI_2D;
    panel.addChild(this.resultList);
    this.againBtn = this.makeBtn(panel, "再来一局", 0, -140, 180, 40, () =>
      this.cb.onAgain()
    );
    this.againLbl = this.againBtn.getComponentInChildren(Label)!;
    this.resultRestartBtn = this.makeBtn(panel, "重新开始", 0, -140, 180, 40, () =>
      this.cb.onMenuRestart()
    );
    this.resultRestartBtn.active = false;
    this.exitBtn = this.makeBtn(panel, "返回大厅", 0, -140, 180, 40, () =>
      this.cb.onExit()
    );
    this.resultSettleBtn = this.makeBtn(
      panel,
      "结算本场",
      0,
      -195,
      180,
      40,
      () => {
        this.settleBack = "result";
        this.show("settle-confirm");
      },
      true
    );
    this.resultSettleBtn.active = false;
    return panel;
  }

  private buildGuide(): Node {
    const panel = this.panel("Guide", 480, 440);
    this.makeLabel(panel, "怎么玩", 0, 170, 28, C.gold);
    const lines = [
      "1. 目标：吃红色分牌，比底分（240÷人数）高就赢",
      "红鬼 30 · 红A 20 · 红9~K 10 · 红2~8 面值",
      "2. 配对：A~9 凑成 10；10/J/Q/K 同点；大小王互吃",
      "3. 操作：点手牌 → 有目标则吃，无目标再点一次弃牌",
      "4. 每回合出手牌后再翻牌堆，能吃也要吃",
      "5. 多轮不限局数；首轮随机庄，之后逆时针；房主菜单可结算",
    ];
    lines.forEach((t, i) =>
      this.makeLabel(
        panel,
        t,
        0,
        100 - i * 30,
        i === 1 ? 14 : 15,
        i === 1 ? C.gold : C.cream
      )
    );
    this.makeBtn(
      panel,
      "知道了，开打",
      0,
      -180,
      200,
      40,
      () => this.cb.onGuideOk(),
      true
    );
    return panel;
  }

  private buildRules(): Node {
    const panel = this.panel("Rules", 280, 440);
    this.makeLabel(panel, "玩法规则", 0, 160, 24, C.gold);
    const viewport = new Node("RulesViewport");
    viewport.layer = Layers.Enum.UI_2D;
    panel.addChild(viewport);
    viewport.setPosition(new Vec3(0, 10, 0));
    viewport.addComponent(UITransform).setContentSize(new Size(250, 250));
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;

    const content = new Node("RulesContent");
    content.layer = Layers.Enum.UI_2D;
    viewport.addChild(content);
    content.addComponent(UITransform).setContentSize(new Size(250, 400));
    content.setPosition(new Vec3(0, -55, 0));

    const scroll = viewport.addComponent(ScrollView);
    scroll.content = content;
    scroll.horizontal = false;
    scroll.vertical = true;

    const lines = [
      "牌：54 张含大小王。手牌 24 张均分，桌面 6 张，牌堆 24。",
      "配对：A~9 相加为 10；10/J/Q/K 同点；大小王互配。",
      "流程：出手牌 → 能配必吃 → 翻牌堆同样能配必吃 → 下家。",
      "计分：红鬼 30，红 A 20，红 9~K 各 10，红 2~8 按面值。",
      "胜负：得分 − 底分（240÷人数），正为赢、负为输。",
      "多轮：不限局数；首轮随机庄、之后逆时针；菜单可查分，房主可结算。",
    ];
    lines.forEach((t, i) =>
      this.makeLabel(content, t, 0, 140 - i * 58, 13, C.cream)
    );
    this.makeBtn(panel, "明白了", 0, -170, 140, 40, () => this.closeRules());
    return panel;
  }

  private buildMenu(): Node {
    const panel = this.panel("Menu", 280, 260);
    this.makeCloseX(panel, () => this.show("none"));
    this.makeLabel(panel, "菜单", 0, 90, 26, C.gold);
    this.makeBtn(panel, "查看当前积分", 0, 30, 200, 40, () =>
      this.cb.onMenuScores()
    );
    this.makeBtn(panel, "查看规则", 0, -20, 200, 40, () =>
      this.openRules("menu")
    );
    this.settleBtn = this.makeBtn(
      panel,
      "结算对局",
      0,
      -75,
      200,
      40,
      () => {
        this.settleBack = "menu";
        this.show("settle-confirm");
      },
      true
    );
    return panel;
  }

  private buildScores(): Node {
    const panel = this.panel("Scores", 320, 340);
    this.makeLabel(panel, "当前积分", 0, 120, 26, C.gold);
    this.scoresRound = this.makeLabel(panel, "", 0, 85, 15, C.goldDim);
    this.scoresList = new Node("ScoresList");
    this.scoresList.layer = Layers.Enum.UI_2D;
    panel.addChild(this.scoresList);
    this.makeBtn(panel, "关闭", 0, -130, 130, 38, () => this.show("none"));
    return panel;
  }

  private buildSettleConfirm(): Node {
    const panel = this.panel("SettleConfirm", 300, 250);
    this.makeLabel(panel, "结算对局", 0, 82, 24, C.gold);
    this.makeLabel(panel, "确定结算本场对局？", 0, 40, 17, C.cream);
    this.makeBtn(panel, "取消", 0, -25, 180, 38, () =>
      this.show(this.settleBack)
    );
    this.makeBtn(
      panel,
      "确定结算",
      0,
      -78,
      180,
      40,
      () => this.cb.onMenuSettle(),
      true
    );
    return panel;
  }

  private panel(name: string, w: number, h: number): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    this.root.addChild(n);
    n.addComponent(UITransform).setContentSize(new Size(w, h));
    const g = n.addComponent(Graphics);
    g.fillColor = C.panelBg;
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    g.fill();
    g.strokeColor = C.goldDim;
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, 16);
    g.stroke();
    return n;
  }

  private makeCloseX(parent: Node, onClick: () => void): void {
    const ut = parent.getComponent(UITransform);
    const w = ut?.contentSize.width ?? 280;
    const h = ut?.contentSize.height ?? 300;
    const n = new Node("CloseX");
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.setPosition(new Vec3(w / 2 - 22, h / 2 - 22, 0));
    n.addComponent(UITransform).setContentSize(new Size(36, 36));
    this.makeLabel(n, "×", 0, 0, 28, new Color(243, 234, 214, 180));
    n.on(Node.EventType.TOUCH_END, onClick);
  }

  private makeBtn(
    parent: Node,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
    primary = false
  ): Node {
    const n = new Node(text);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.setPosition(new Vec3(x, y, 0));
    n.addComponent(UITransform).setContentSize(new Size(w, h));
    this.paintBtn(n, primary);
    this.makeLabel(n, text, 0, 0, 20, C.cream);
    n.on(Node.EventType.TOUCH_END, onClick);
    return n;
  }

  private paintBtn(n: Node, primary: boolean): void {
    const ut = n.getComponent(UITransform);
    const w = ut?.contentSize.width ?? 180;
    const h = ut?.contentSize.height ?? 40;
    let g = n.getComponent(Graphics);
    if (!g) g = n.addComponent(Graphics);
    g.clear();
    g.fillColor = primary ? C.seal : new Color(201, 169, 97, 40);
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.fill();
    g.strokeColor = primary ? C.seal : C.gold;
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.stroke();
  }

  private makeLabel(
    parent: Node,
    text: string,
    x: number,
    y: number,
    size: number,
    color: Color
  ): Label {
    const n = new Node("Lbl");
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.setPosition(new Vec3(x, y, 0));
    n.addComponent(UITransform);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.color = color;
    l.horizontalAlign = Label.HorizontalAlign.CENTER;
    l.verticalAlign = Label.VerticalAlign.CENTER;
    return l;
  }

  private makeEdit(
    parent: Node,
    x: number,
    y: number,
    w: number,
    h: number,
    placeholder: string
  ): EditBox {
    const n = new Node("Edit");
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.setPosition(new Vec3(x, y, 0));
    n.addComponent(UITransform).setContentSize(new Size(w, h));
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(8, 26, 20, 220);
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.fill();
    g.strokeColor = C.goldDim;
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.stroke();

    const textNode = new Node("TEXT_LABEL");
    textNode.layer = Layers.Enum.UI_2D;
    n.addChild(textNode);
    textNode.addComponent(UITransform).setContentSize(new Size(w - 16, h));
    const textLabel = textNode.addComponent(Label);
    textLabel.fontSize = 20;
    textLabel.color = C.cream;
    textLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    textLabel.verticalAlign = Label.VerticalAlign.CENTER;

    const phNode = new Node("PLACEHOLDER_LABEL");
    phNode.layer = Layers.Enum.UI_2D;
    n.addChild(phNode);
    phNode.addComponent(UITransform).setContentSize(new Size(w - 16, h));
    const phLabel = phNode.addComponent(Label);
    phLabel.string = placeholder;
    phLabel.fontSize = 18;
    phLabel.color = C.goldDim;
    phLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    phLabel.verticalAlign = Label.VerticalAlign.CENTER;

    const eb = n.addComponent(EditBox);
    eb.inputMode = EditBox.InputMode.SINGLE_LINE;
    eb.maxLength = 10;
    eb.placeholder = placeholder;
    eb.textLabel = textLabel;
    eb.placeholderLabel = phLabel;
    return eb;
  }
}
