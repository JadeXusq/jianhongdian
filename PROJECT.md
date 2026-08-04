# 捡红点（JianHongDian）项目方案与技术文档

> 本文档面向"接手继续开发/优化"的工程师或 AI，描述项目的**当前真实状态**（以代码为准）。
> 所有节奏参数、目录结构均已核对代码，勿以过往对话为准。

---

## 一、项目定位

一款**新中式风格**的传统扑克牌休闲游戏「捡红点」，支持 **2~4 人实时联网对战 + AI 人机**。

- 一套规则引擎（`shared/`）同时服务 **Web 客户端** 与 **Cocos 客户端**，逻辑零分叉。
- 服务器权威（server-authoritative）：所有发牌、配对、计分在服务端裁决，客户端只做展示与操作，杜绝改分作弊。
- 当前进度：Web 版功能完整（可真机联机开黑）；Cocos 版已接入联机（大厅/房间/观战/表情），牌面位图图集，本地账号绑定。

---

## 二、游戏规则（已与用户确认，务必严格遵守）

### 牌与发牌
- 使用 **54 张完整扑克**（含大小王）。
- 固定发 **24 张手牌**，按人数均分：2 人各 12 张 / 3 人各 8 张 / 4 人各 6 张。
- 桌面掀 **6 张明牌**，其余 **24 张**作牌堆。
- 校验恒等式：`手牌24 + 桌面6 + 牌堆24 = 54`。
- 初始 6 张明牌若存在可互相配对的，重新洗牌发牌。

### 配对规则
- **A~9**：两张点数**相加为 10**（A=1）。
- **10/J/Q/K**：**同点数**配对。
- **大小王**：互相配对，不与其他牌配。

### 计分（全场共 240 分）
| 牌 | 分值 |
|---|---|
| 大王（红鬼） | 30 |
| ♥A / ♦A | 各 20 |
| 红色 9/10/J/Q/K | 各 10 |
| 红色 2~8 | 按面值 |
| 所有黑牌 + 小王 | 0 |

### 回合流程
1. 出一张手牌 → 能配对必须吃（多个目标可自选吃哪张）→ 否则留在桌面。
2. 从牌堆翻一张 → 同样能配必吃（多目标进入选择阶段）→ 否则留桌面。
3. 轮到下家。所有手牌 + 牌堆耗尽 → 终局。

### 胜负与多轮
- 底分 = 240 ÷ 人数；单轮净分 = 吃到分 − 底分（零和）。
- **多轮制**：默认 **5 轮**（可配 1~20），每轮结束 3 秒后自动开下一轮，打满才出最终总结算（累计净分）。

---

## 三、技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 规则引擎 | 纯 TypeScript（无框架依赖） | TS 5.5 |
| 服务器 | Node.js + Colyseus | colyseus 0.15 |
| Web 客户端 | 原生 TS + Canvas 2D + Vite | vite 5.4 |
| Cocos 客户端 | Cocos Creator（Graphics/Label 纯代码建节点） | 3.8.8 |
| 单元测试 | Vitest | 2.1 |
| 包管理 | npm workspaces（monorepo） | — |

> 说明：Web 与 Cocos 两端 UI 均为**程序化绘制**，不依赖任何图片/字体素材，牌面全部代码画出。

---

## 四、目录结构

```
games/
├── package.json         # npm workspaces 根（shared/server/client）
├── shared/              # 规则引擎（唯一源头，363 行）
│   ├── src/
│   │   ├── cards.ts     # 牌定义、配对判定 canPair、计分 cardScore、发牌
│   │   ├── rng.ts       # 可播种随机 mulberry32 + shuffle（发牌可复现）
│   │   ├── game.ts      # Game 类：回合状态机（PLAY_HAND/CHOOSE_STOCK_TARGET/FINISHED）
│   │   ├── ai.ts        # chooseHandPlay / bestTarget（人机 + 超时托管共用）
│   │   └── index.ts
│   └── test/            # cards.test.ts + game.test.ts（15 用例，含 2/3/4 人各 300 局模拟）
├── server/              # Colyseus 服务器（538 行）
│   ├── src/
│   │   ├── index.ts     # HTTP + WebSocket 入口，房号/排行榜 REST
│   │   ├── GameRoom.ts  # 房间：座位/准备/回合驱动/AI补位/超时托管/断线重连/多轮
│   │   ├── state.ts     # Colyseus Schema（同步状态，手牌私发不入 state）
│   │   ├── roomCodes.ts # 6 位房号 ↔ roomId 注册表
│   │   └── store.ts     # 游客战绩 JSON 落盘 + 排行榜
│   └── scripts/         # smoke.ts / smokeReconnect.ts（联机冒烟测试）
├── client/              # Web 客户端（1587 行）
│   └── src/
│       ├── net.ts       # Colyseus 连接封装（房间/匹配/重连/deviceId）
│       ├── table.ts     # 牌桌视图：布局/绘制/命中/动画（核心，动态逻辑宽度+软件旋转）
│       ├── cardRender.ts# 牌面程序化绘制
│       ├── main.ts      # 界面切换 + 出牌交互 + 多轮结算
│       ├── layout.ts    # 竖屏软件旋转检测
│       ├── audio.ts     # WebAudio 程序化音效 + 五声音阶背景乐
│       └── styles.css
├── cocos/               # Cocos 工程（脚本 881 行）
│   └── assets/scripts/
│       ├── GameEntry.ts # 牌桌入口（纯代码建节点，单机人机）
│       ├── CardNode.ts  # 牌面绘制（Graphics + Label）
│       ├── Theme.ts     # 配色常量
│       ├── rules/       # 从 shared/src 同步的规则副本（勿手改）
│       └── lib/colyseus.js # esbuild 从 exports.browser 打包的 SDK
└── tools/               # 自动化验证脚本（1070 行，playwright-core 驱动）
    ├── visualCheck.mjs      # Web 双端开局打完整局 + 截图
    ├── mobileCheck.mjs      # 多机型横屏/触摸验证
    ├── genCocosScene.mjs    # 生成 Cocos .scene（含压缩 UUID 算法）
    ├── syncCocosLib.mjs     # 同步 shared/ + 打包 colyseus 进 Cocos
    └── cocosUuid.mjs / canvasTap.mjs
```

---

## 五、核心架构设计

### 5.0 系统总览

```
        ┌──────────────┐        ┌──────────────┐
        │  Web 客户端   │        │ Cocos 客户端  │
        │  client/      │        │  cocos/       │
        │ Canvas 渲染   │        │ Graphics 渲染 │
        │ net.ts 联机   │        │ Net.ts 联机    │
        └──────┬───────┘        └──────┬───────┘
               │  WebSocket (Colyseus)  │
               │  · room.send(出牌/选目标/准备)
               │  · onMessage('hand') 私收手牌
               │  · onStateChange 同步公开状态
               ▼                        ▼
        ┌───────────────────────────────────────┐
        │          server/  (Colyseus)          │
        │  GameRoom：房间/回合驱动/AI/重连/多轮   │
        │  RoomState：公开状态同步（手牌不入）    │
        │  store.ts：游客战绩落盘 + 排行榜        │
        └───────────────────┬───────────────────┘
                            │ import（服务端权威裁决）
                            ▼
        ┌───────────────────────────────────────┐
        │   shared/  规则引擎（纯 TS，唯一源头）  │
        │   Game 状态机 · 配对 · 计分 · AI · RNG  │
        └───────────────────────────────────────┘
                            │ tools/syncCocosLib.mjs 复制
                            ▼
                 cocos/assets/scripts/rules/（构建物）
```

**数据流要点**：
- 客户端只发**操作意图**（出哪张牌/选哪个目标），服务端用 `shared/` 规则裁决后广播结果。
- 手牌是私密信息，**不进** `RoomState`（否则会被抓包看到），单独 `send('hand')` 给本人。
- `shared/` 是唯一规则源头：server 直接 `import`，Cocos 通过同步脚本复制（保证三端逻辑零分叉）。

### 5.1 规则引擎（shared/）
- **纯函数 + 无 IO**：`Game` 类持有一局完整状态，服务端和客户端都能实例化。
- **可播种随机**：`mulberry32(seed)` 保证发牌可复现，便于测试与调试。
- **状态机三态**：`PLAY_HAND`（出手牌）→ 若翻牌多目标则 `CHOOSE_STOCK_TARGET`（等选择）→ `FINISHED`。
- 关键 API：`playHandCard(player, cardId, targetId?)`、`chooseStockTarget()`、`stockTargets()`、`result()`。

### 5.2 服务器权威（server/）
- **手牌私密**：`RoomState` 只同步公开信息（桌面牌、各家分数、剩牌数、当前座位）；手牌通过 `client.send('hand', ...)` 单独私发，防窥牌。
- **房间生命周期**：座位分配 → 准备/加 AI → 开局发牌 → 回合驱动 → 结算 → （未满轮）自动下一轮。
- **AI 补位 + 超时托管**：空位由 AI 顶替；真人超时未操作由 AI 代打本回合，保证对局不卡死。
- **断线重连**：Colyseus `allowReconnection`，掉线保留座位 60 秒，期间 AI 托管；超时未回则永久转 AI。
- **房主信息入 state**（`hostSessionId`）：避免客户端依赖消息到达顺序产生竞态。

### 5.3 Web 客户端（client/）
- **网络层与渲染层分离**：`net.ts`（Colyseus 封装）不含渲染，`table.ts` 只管画。这是当初为"后接 Cocos"做的解耦。
- **动态自适应**：逻辑高度固定 720，逻辑宽度随屏幕比例在 1040~1700 间伸缩，手机零黑边、平板小边。
- **软件旋转**：竖屏时整幅 Canvas + DOM 旋转 90°（网页无法调用系统转屏），保证强制横屏。

### 5.4 Cocos 客户端（cocos/）
- **纯代码建节点**：场景文件只有一个空节点挂 `GameEntry`，所有牌/面板/文字用 Graphics+Label 代码生成。
- **规则同步**：`tools/syncCocosLib.mjs` 把 `shared/src` 复制进 `cocos/assets/scripts/rules/`（构建物，勿手改）。
- **联机 SDK**：必须从 colyseus.js 的 `exports.browser`（`lib/index.js`）用 esbuild 打成 IIFE，不能用 `dist/` 的 UMD（含 Node 版 ws，浏览器报 `Buffer is not defined`）。

---

## 六、交互节奏参数（当前真实值，核对自代码）

> ⚠️ 节奏经过多轮调整，这是**当前代码里的实际值**。调整时务必改 `shared/src/timing.ts` 一处，三端自动一致（server 直接引；client workspace 引；cocos 经 `syncCocosLib.mjs`）。

| 参数 | 常量（`shared/src/timing.ts`） | 当前值 |
|---|---|---|
| 人类回合超时（超时 AI 代打） | `TURN_MS` | 60 秒 |
| 服务器 AI 出牌间隔 | `AI_DELAY_MS` | **2 秒**（另加吃牌动画垫时）|
| 断线保留座位 | `RECONNECT_MS` | 60 秒 |
| 默认总轮数 | `server/state.ts` `totalRounds` | 5（可配 1~20）|
| Web 出牌飞向目标后停顿 | `FLY_TARGET_HOLD_S` | 0.3 秒 |
| Web **MATCH 居中展示**停顿 | `MATCH_HOLD_S` | **2.2 秒**（可点击跳过）|
| Web 飞入得分堆后停顿 | `FLY_PILE_HOLD_S` | 0.6 秒 |
| 轮间结算弹窗自动关闭 | `ROUND_RESULT_AUTO_MS` | 5 秒 |

**MATCH 动效**：吃牌成功后两张牌居中放大，显示「MATCH! +得分」，停留约 2.2 秒（可点击跳过）再飞入得分堆。服务端 AI 会在吃牌动画估算时长 + `AI_DELAY_MS` 后再出牌。

---

## 七、运行与验证

```bash
# 安装依赖（monorepo，根目录一次装全部）
npm install

# 规则引擎单元测试（15 用例，含 2/3/4 人各 300 局全自动模拟）
npm run test -w shared

# 启动服务器（ws://localhost:2567，含 /api 房号/排行榜）
npm run start -w server

# 启动 Web 客户端（vite，默认 5173，--host 可局域网访问）
npm run dev -w client

# 服务器联机冒烟（需先启服务器）
npm run smoke -w server            # 完整对局
npm run smoke:reconnect -w server  # 断线重连

# Cocos 构建（CLI 无头）
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project $(pwd)/cocos --build "platform=web-mobile"

# 同步规则 + colyseus 进 Cocos（改完 shared/ 后执行）
node tools/syncCocosLib.mjs
```

**浏览器自动化验证**（复用系统缓存的 Chromium，`playwright-core` 装在 `/tmp/jhd-shot`）：
```bash
PW=/tmp/jhd-shot/node_modules/playwright-core/index.js node tools/visualCheck.mjs
```

---

## 八、已知坑（务必避免重踩）

1. **`crypto.randomUUID()` 只在安全上下文可用**：局域网 HTTP + IP 访问会崩。已改用 `crypto.getRandomValues` 生成游客 deviceId（见 `net.ts`）。
2. **Cocos 引 colyseus 的 Buffer 报错**：见 5.4，必须从 `exports.browser` 打包。
3. **esbuild 全局挂载**：`globalName` 不能写 `globalThis.Colyseus`（会生成 `var globalThis` 屏蔽真全局），要用 `globalName:"Colyseus"` + footer 显式赋值。
4. **Cocos 黑屏**：`project.json` 缺 `startScene`；且编辑器预览用的是**当前打开的场景**，需先双击 `main.scene`。
5. **截图 MCP 工具超时**：rAF 渲染循环让页面永不 idle，改用 `tools/` 里的 playwright 脚本截图。

---

## 九、当前进度与待优化项（供 AI 优化参考）

### 已完成
- ✅ 规则引擎 + 单测全绿（含 AI 难度；数学性质：总分恒 240、桌面必清空、零和）
- ✅ 服务器：房间/房号/快速匹配/AI 补位/超时托管/断线重连/多轮/观战/表情/本地账号
- ✅ Web 客户端：完整可玩，多机型横屏自适应，游客+账号绑定 + 排行榜，位图牌面，程序化音效/背景乐
- ✅ Cocos 客户端：联机大厅/牌桌/观战/表情 API，牌面图集，规则与 Colyseus 同步脚本
- ✅ 节奏参数集中于 `shared/src/timing.ts`，三端共用

### 优化时的红线
- 规则引擎（`shared/`）改动必须先跑 `npm run test -w shared`，数学性质不能破坏。
- 任何节奏调整，server + client + cocos **三端同步**。
- 服务器权威原则不能破：客户端永远不做计分裁决。
- 改完用 `tools/visualCheck.mjs` 跑一局验证零报错再收工。

---

## 十、TODO 待办清单（供后续接管）

> 每个待办是一张可独立认领的任务卡：含**目标 / 涉及文件 / 验收标准**。
> 认领前先读第五节架构与第八节已知坑；完成后按第七节验证并勾选。
> 优先级：P0 最高。

### ✅ TODO-1 [P0] Cocos 客户端接入联机
> 工作量最大，拆成 3 个可独立验证的子任务，按序完成。
> 参照物：`client/src/net.ts`（联机封装）与 `client/src/main.ts`（状态驱动渲染 + 出牌交互）已是成熟实现，Cocos 端照搬其模型即可。

- **✅ 1a 网络层移植**：新建 `cocos/assets/scripts/Net.ts`，用全局 `Colyseus`（已由 `syncCocosLib.mjs` 打进 `lib/colyseus.js`）实现与 `client/src/net.ts` **同名的接口**：
  - 方法：`create/quickMatch/joinByCode/ready/addAi/play/chooseTarget/nextRound/leave/tryReconnect`
  - 回调：`onState/onEvents/onRoundStart/onRoundOver/onError/onLeave` + `onMessage('hand')` 私收手牌
  - **验收**：✅ 已通过——Cocos 构建页 `probeNet()` 连上 `ws://localhost:2567`，创建 2 人房 + AI，收到 12 张 hand。
- **✅ 1b 渲染改为服务器状态驱动**：`GameEntry.ts` 去掉本地 `new Game()`，改为消费 `Net` 的状态/事件渲染牌桌；出牌调 `net.play()` 而非本地状态机。
  - **验收**：✅ 已通过——`tools/cocosNetRound.ts`：Cocos + Web 客户端 + AI 打完 1 轮，桌面/手牌/得分随服务器同步，收到 roundOver。
- **✅ 1c 大厅与房间 UI**：补 Cocos 端的大厅（昵称/人数/创建/房号加入）与房间等待界面（现 Web 有，Cocos 无）。
  - **验收**：✅ 已通过——`tools/cocosCheck.ts`（`?auto=1`）从开房到 roundOver，控制台零报错。

### ✅ TODO-2 [P1] 节奏参数集中化
- **现状**：节奏散落三处——`server/src/GameRoom.ts`（`TURN_MS`/`AI_DELAY_MS`）、`client/src/table.ts`（各 `hold`）、`cocos/.../GameEntry.ts`（`scheduleOnce`），改一处易漏两处。
- **目标**：抽出单一节奏配置源，三端引用同一份值。
- **建议**：在 `shared/src` 加 `timing.ts` 导出常量（如 `MATCH_HOLD_MS`、`AI_DELAY_MS`），server 直接引，client/cocos 通过既有同步机制（`syncCocosLib.mjs`）复用。
- **验收**：✅ 已完成——`shared/src/timing.ts` 为唯一源头；server/client/cocos 均引用；`npm run test -w shared` 全绿。

### ✅ TODO-3 [P2] AI 难度分级
- **现状**：`shared/src/ai.ts` 仅一种贪心策略（`chooseHandPlay`：收益=自身分+最高分目标；无可吃时弃最低分牌）。
- **目标**：新增难度参数（简单/普通/困难），如简单随机出牌、困难考虑"不给下家送红牌"。
- **涉及文件**：`shared/src/ai.ts`（加 difficulty 入参）、`server/src/GameRoom.ts`（加 AI 时传难度）。
- **验收**：✅ 已完成——easy/normal/hard + `ai.test.ts`；`npm run test -w shared` 全绿；`addAi` / 建房可传 `aiDifficulty`。

### ✅ TODO-4 [P2] 牌面素材化（可选，视觉打磨）
- **现状**：Web（`cardRender.ts`）与 Cocos（`CardNode.ts`）均程序化绘制牌面，系统字体在不同设备有差异。
- **目标**：换位图字体或图片素材提升精致度与一致性。
- **验收**：✅ 已完成——`tools/genCardAtlas.mjs` 预烘焙 `card-atlas.png`（54 牌+牌背）；Web/Cocos 优先贴图，失败回退程序化；`tools/mobileCheck.mjs` 多机型通过。

### ✅ TODO-5 [P3] 玩法扩展
> 拆为可独立认领的子任务，遵守服务器权威红线。

- **✅ 5a 观战模式**：旁观已开局房间（只收公开 state，无操作权）；房主/规则允许观战席。
  - 涉及：`server/GameRoom.ts`、`client`/`cocos` UI
  - **验收**：✅ `tools/spectateSmoke.ts` 通过——第三人 spectate，seat=-1，无 hand，不占玩家位；Web「房号观战」/ Cocos 大厅按钮已接。
- **✅ 5b 表情互动**：对局中发送预设表情/快捷语，广播给同房。
  - 涉及：`server` 消息通道、两端 UI
  - **验收**：✅ `tools/emoteSmoke.ts` 通过；Web 对局底栏 5 个快捷语，非法 id 被服务端丢弃。
- **✅ 5c 正式账号体系**：在现有游客 `deviceId` 之上增加登录绑定（可先做占位接口）。
  - 涉及：`server/store.ts`、鉴权与战绩迁移
  - **验收**：✅ 本地账号占位完成——`POST /api/account/create|bind`，多设备绑定合并战绩；`tools/accountSmoke.ts` 通过；Web「账号绑定」页可创建/绑定。未接第三方登录。

### 待办维护约定
- 完成一项：把 `⬜` 改为 `✅` 并一行注明验证结果（如"✅ TODO-1 已接入，visualCheck 通过"）。
- 新需求追加为新的 TODO-N，保留编号连续，标注优先级。

### ✅ TODO-6 [P2] Cocos 功能对齐（表情栏 / 账号页）
- **目标**：Cocos 大厅补「账号绑定」，对局中显示表情快捷栏（与 Web 一致）。
- **验收**：✅ LobbyUI 已含账号页与表情栏；对局 `PLAYING` 时 `setEmotesVisible(true)`。

### ✅ TODO-8 [P2] Cocos UX 对齐 Web 评审修复
- **目标**：将 reviews 中 Web 端体验修复同步到 Cocos（引导、弃牌视觉、MATCH 跳过、得分堆、结算、表情气泡、2 人布局等）。
- **验收**：✅ LobbyUI 含 guide/rules/表情气泡/结算圆点；GameEntry 含 MATCH 跳过与粒子、弃牌「弃」态、得分条展开、翻牌居中提示、2 人对手偏右。
