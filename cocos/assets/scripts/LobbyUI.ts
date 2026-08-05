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
  onReady(): void;
  onAddAi(): void;
  onAiDifficulty(d: "easy" | "normal" | "hard"): void;
  onQuit(): void;
  onAgain(): void;
  onExit(): void;
  onGuideOk(): void;
  onRulesClose(): void;
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
  private emotes!: Node;
  private helpBtn!: Node;
  private emoteBubble!: Label;
  private emoteTimer = 0;
  private nameBox!: EditBox;
  private codeBox!: EditBox;
  private accIdBox!: EditBox;
  private accTokenBox!: EditBox;
  private accStatusLbl!: Label;
  private accHintLbl!: Label;
  private count = 4;
  private countLabels: Label[] = [];
  private roomCodeLbl!: Label;
  private seatsNode!: Node;
  private readyLbl!: Label;
  private aiBtn!: Node;
  private aiDiffLabels: Label[] = [];
  private resultTitle!: Label;
  private resultDots!: Node;
  private resultList!: Node;
  private againLbl!: Label;
  private exitBtn!: Node;
  private toastLbl!: Label;
  private toastTimer = 0;

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
    this.emotes = this.buildEmotes();
    this.helpBtn = this.makeBtn(this.root, "?", DESIGN.width / 2 - 70, DESIGN.height / 2 - 36, 36, 36, () =>
      this.show("rules")
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
    if (screen !== "none") this.setEmotesVisible(false);
  }

  setEmotesVisible(v: boolean): void {
    this.emotes.active = v;
  }

  setHelpVisible(v: boolean): void {
    this.helpBtn.active = v;
  }

  isOverlay(): boolean {
    return this.guide.active || this.rules.active;
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
      好棋: "👏",
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
    }, 3000) as unknown as number;
  }

  playerName(): string {
    const v = (this.nameBox.string || "").trim() || "无名客";
    try {
      localStorage.setItem("jhd.name", v);
    } catch {
      /* ignore */
    }
    return v.slice(0, 12);
  }

  renderRoom(state: any, mySessionId: string): void {
    this.roomCodeLbl.string = state.code || "------";
    this.seatsNode.removeAllChildren();
    const players = [...state.players.values()] as any[];
    const startY = 90;
    for (let i = 0; i < state.maxPlayers; i++) {
      const p = players.find((x) => x.seat === i);
      const line = p
        ? `${p.name}${p.isAi ? " · 电脑" : ""}${
            p.sessionId === mySessionId ? "（我）" : ""
          }  ${p.ready ? "已准备" : "等待中"}`
        : `座位 ${i + 1}  空`;
      this.makeLabel(
        this.seatsNode,
        line,
        0,
        startY - i * 36,
        22,
        p ? C.cream : C.goldDim
      );
    }
    const me = players.find((x) => x.sessionId === mySessionId);
    this.readyLbl.string = me?.ready ? "取消准备" : "准备";
    const isHost = state.hostSessionId === mySessionId;
    this.aiBtn.active = isHost && players.length < state.maxPlayers;
  }

  renderResult(r: RoundOver, state: any, mySeat: number): void {
    const players = [...state.players.values()] as any[];
    const rows = players
      .map((p) => ({ p, points: r.points[p.seat], net: r.net[p.seat] }))
      .sort((a, b) => b.net - a.net);
    const winner = rows[0];
    const iWin = winner?.p.seat === mySeat && winner.net >= 0;
    this.resultTitle.string = r.allDone
      ? iWin
        ? "最终结算 · 胜"
        : `最终结算（${r.totalRounds} 轮）`
      : `第 ${r.round} / ${r.totalRounds} 轮`;

    this.resultDots.removeAllChildren();
    for (let i = 0; i < r.totalRounds; i++) {
      const on = i < r.round;
      const d = new Node("Dot");
      d.layer = Layers.Enum.UI_2D;
      this.resultDots.addChild(d);
      d.setPosition(new Vec3((i - (r.totalRounds - 1) / 2) * 18, 0, 0));
      const g = d.addComponent(Graphics);
      g.fillColor = on ? C.gold : new Color(0, 0, 0, 0);
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
        (r.allDone ? ` | 总 ${row.p.totalNet}` : "");
      this.makeLabel(
        this.resultList,
        `${rank}. ${row.p.name}${row.p.isAi ? "·电脑" : ""}${mark}  ${row.points}分  ${net}`,
        0,
        50 - i * 36,
        20,
        row.p.seat === mySeat ? C.gold : C.cream
      );
    });
    this.againLbl.string = r.allDone
      ? "再来一局"
      : `继续下一轮 (${r.round}/${r.totalRounds})`;
    this.exitBtn.active = !!r.allDone;
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

    this.makeBtn(panel, "人机练习", 0, -10, 270, 42, () =>
      this.cb.onPractice(this.playerName(), this.count)
    );
    this.makeBtn(panel, "快速匹配", 0, -60, 270, 40, () =>
      this.cb.onMatch(this.playerName(), this.count)
    );
    this.makeBtn(panel, "创建房间", -75, -112, 125, 38, () =>
      this.cb.onCreate(this.playerName(), this.count)
    );
    this.makeBtn(panel, "输房号加入", 75, -112, 125, 38, () => {
      const code = (this.codeBox.string || "").trim();
      if (!code) {
        this.toast("请先填写房号");
        return;
      }
      this.cb.onJoin(this.playerName(), code);
    });
    this.makeBtn(panel, "房号观战", -75, -160, 125, 36, () => {
      const code = (this.codeBox.string || "").trim();
      if (!code) {
        this.toast("请先填写房号");
        return;
      }
      this.cb.onSpectate(this.playerName(), code);
    });
    this.makeBtn(panel, "账号绑定", 75, -160, 125, 36, () =>
      this.cb.onAccount()
    );

    this.makeLabel(panel, "房号", -130, -208, 16, C.goldDim);
    this.codeBox = this.makeEdit(panel, 20, -212, 190, 34, "6位房号");
    this.makeBtn(panel, "查看规则", 0, -255, 120, 30, () => this.show("rules"));
    return panel;
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
    this.makeBtn(panel, "创建并绑定", -80, -70, 150, 40, () =>
      this.cb.onAccCreate(this.playerName())
    );
    this.makeBtn(panel, "绑定已有", 90, -70, 130, 40, () => {
      const id = (this.accIdBox.string || "").trim();
      const tok = (this.accTokenBox.string || "").trim();
      if (!id || !tok) {
        this.toast("请填写账号与凭证");
        return;
      }
      this.cb.onAccBind(id, tok);
    });
    this.accHintLbl = this.makeLabel(panel, "", 0, -120, 14, C.goldDim);
    this.makeBtn(panel, "返回", 0, -160, 120, 36, () => this.show("lobby"));
    return panel;
  }

  private buildEmotes(): Node {
    const bar = new Node("Emotes");
    bar.layer = Layers.Enum.UI_2D;
    this.root.addChild(bar);
    // 右侧竖排，避开底部手牌点击区
    bar.setPosition(new Vec3(DESIGN.width / 2 - 56, -DESIGN.height / 2 + 170, 0));
    const list = ["加油", "好棋", "厉害", "等等", "哈哈哈"];
    list.forEach((text, i) => {
      this.makeBtn(bar, text, 0, i * 38, 88, 32, () => this.cb.onEmote(text));
    });
    bar.active = false;
    return bar;
  }

  private buildRoom(): Node {
    const panel = this.panel("Room", 420, 460);
    this.makeLabel(panel, "房间等待", 0, 190, 28, C.gold);
    this.roomCodeLbl = this.makeLabel(panel, "------", 0, 145, 36, C.seal);
    this.seatsNode = new Node("Seats");
    this.seatsNode.layer = Layers.Enum.UI_2D;
    panel.addChild(this.seatsNode);

    this.makeLabel(panel, "AI难度", -150, -100, 16, C.goldDim);
    this.aiDiffLabels = [];
    (["easy", "normal", "hard"] as const).forEach((d, i) => {
      const names = { easy: "简单", normal: "普通", hard: "困难" };
      const x = -60 + i * 90;
      const btn = this.makeBtn(panel, names[d], x, -105, 80, 32, () => {
        this.cb.onAiDifficulty(d);
        this.aiDiffLabels.forEach((l, j) => {
          l.color = j === i ? C.seal : C.cream;
        });
      });
      const lbl = btn.getComponentInChildren(Label)!;
      this.aiDiffLabels.push(lbl);
      if (d === "normal") lbl.color = C.seal;
    });

    this.aiBtn = this.makeBtn(panel, "＋ 添加电脑", -90, -160, 150, 40, () =>
      this.cb.onAddAi()
    );
    const readyBtn = this.makeBtn(panel, "准备", 90, -160, 120, 40, () =>
      this.cb.onReady()
    );
    this.readyLbl = readyBtn.getComponentInChildren(Label)!;
    this.makeBtn(panel, "离开房间", 0, -210, 160, 36, () => this.cb.onQuit());
    return panel;
  }

  private buildResult(): Node {
    const panel = this.panel("Result", 440, 420);
    this.resultTitle = this.makeLabel(panel, "本局结算", 0, 160, 28, C.gold);
    this.resultDots = new Node("Dots");
    this.resultDots.layer = Layers.Enum.UI_2D;
    panel.addChild(this.resultDots);
    this.resultDots.setPosition(new Vec3(0, 120, 0));
    this.resultList = new Node("ResultList");
    this.resultList.layer = Layers.Enum.UI_2D;
    panel.addChild(this.resultList);
    const again = this.makeBtn(panel, "再来一局", -80, -160, 150, 40, () =>
      this.cb.onAgain()
    );
    this.againLbl = again.getComponentInChildren(Label)!;
    this.exitBtn = this.makeBtn(panel, "返回大厅", 90, -160, 130, 40, () =>
      this.cb.onExit()
    );
    return panel;
  }

  private buildGuide(): Node {
    const panel = this.panel("Guide", 480, 400);
    this.makeLabel(panel, "怎么玩", 0, 150, 28, C.gold);
    const lines = [
      "1. 目标：吃红色分牌，比底分（240÷人数）高就赢",
      "红鬼 30 · 红A 20 · 红9~K 10 · 红2~8 面值",
      "2. 配对：A~9 凑成 10；10/J/Q/K 同点；大小王互吃",
      "3. 操作：点手牌 → 有目标则吃，无目标再点一次弃牌",
      "4. 每回合出手牌后再翻牌堆，能吃也要吃",
    ];
    lines.forEach((t, i) =>
      this.makeLabel(
        panel,
        t,
        0,
        95 - i * 34,
        i === 1 ? 14 : 16,
        i === 1 ? C.gold : C.cream
      )
    );
    this.makeBtn(panel, "知道了，开打", 0, -160, 200, 40, () =>
      this.cb.onGuideOk()
    );
    return panel;
  }

  private buildRules(): Node {
    const panel = this.panel("Rules", 480, 420);
    this.makeLabel(panel, "玩法规则", 0, 160, 28, C.gold);
    const viewport = new Node("RulesViewport");
    viewport.layer = Layers.Enum.UI_2D;
    panel.addChild(viewport);
    viewport.setPosition(new Vec3(0, 10, 0));
    viewport.addComponent(UITransform).setContentSize(new Size(430, 250));
    viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;

    const content = new Node("RulesContent");
    content.layer = Layers.Enum.UI_2D;
    viewport.addChild(content);
    content.addComponent(UITransform).setContentSize(new Size(430, 340));
    content.setPosition(new Vec3(0, -45, 0));

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
    ];
    lines.forEach((t, i) =>
      this.makeLabel(content, t, 0, 125 - i * 68, 15, C.cream)
    );
    this.makeBtn(panel, "明白了", 0, -170, 140, 40, () =>
      this.cb.onRulesClose()
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

  private makeBtn(
    parent: Node,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void
  ): Node {
    const n = new Node(text);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.setPosition(new Vec3(x, y, 0));
    n.addComponent(UITransform).setContentSize(new Size(w, h));
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(201, 169, 97, 40);
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.fill();
    g.strokeColor = C.gold;
    g.lineWidth = 1;
    g.roundRect(-w / 2, -h / 2, w, h, 8);
    g.stroke();
    this.makeLabel(n, text, 0, 0, 20, C.cream);
    n.on(Node.EventType.TOUCH_END, onClick);
    return n;
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
    eb.maxLength = 12;
    eb.placeholder = placeholder;
    eb.textLabel = textLabel;
    eb.placeholderLabel = phLabel;
    return eb;
  }
}
