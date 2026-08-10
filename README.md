# 捡红点（JianHongDian）

新中式风格扑克休闲游戏，支持 **2~4 人实时联网** 与 **AI 人机**。  
规则引擎统一在 `shared/`，Web 与 Cocos 共用；服务端权威裁决，客户端只负责展示与操作。

更完整的架构、规则、坑点与历史 TODO 见 [`PROJECT.md`](./PROJECT.md)。

## 技术栈

| 层 | 技术 |
|---|---|
| 规则 | TypeScript（`shared/`） |
| 服务 | Node.js + Colyseus `0.15` |
| Web | Vite + Canvas 2D |
| Cocos | Creator `3.8.8` |
| 测试 | Vitest |

## 目录

```
games/
├── shared/    # 规则引擎（唯一源头）
├── server/    # Colyseus 服务端
├── client/    # Web 客户端
├── cocos/     # Cocos 客户端
└── tools/     # 同步脚本 / 冒烟 / 视觉检查
```

## 快速开始

```bash
# 根目录安装（workspaces）
npm install

# 规则单测
npm run test -w shared

# 终端 1：服务端（默认 ws://localhost:2567）
npm run start -w server
# 或热重载：npm run server

# 终端 2：Web 客户端（默认 http://localhost:5173，已 --host）
npm run dev -w client
```

浏览器打开客户端即可创建房间 / 房号加入 / 快速匹配；房间内可加 AI（简单 / 普通 / 困难）。

## Cocos

改完 `shared/` 后先同步再进编辑器：

```bash
node tools/syncCocosLib.mjs
```

无头构建（本机已装 Creator 3.8.8）：

```bash
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project "$(pwd)/cocos" --build "platform=web-mobile"
```

编辑器预览需先打开 `main.scene`。

## 常用验证

```bash
# 服务端联机冒烟（需先启 server）
npm run smoke -w server
npm run smoke:reconnect -w server

# 工具冒烟
npx tsx tools/accountSmoke.ts
npx tsx tools/emoteSmoke.ts
npx tsx tools/spectateSmoke.ts
```

## 部署

### GitHub Pages（静态站 + 离线人机）

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**
2. 推送 `main` 后自动构建；地址：
   - Vite：https://jadexusq.github.io/jianhongdian/
   - Cocos：https://jadexusq.github.io/jianhongdian/cocos/
3. 打开后点 **「人机练习（可离线）」** 即可玩（不依赖服务器）
4. Cocos 产物：本机 Creator 构建 `web-mobile` 后执行 `node tools/syncCocosPages.mjs`，再提交 `publish/cocos/`

### Render 免费档（联网对战服务端）

1. 打开 [Render](https://render.com) 用 GitHub 登录
2. **New → Blueprint**，选仓库 `JadeXusq/jianhongdian`（会读根目录 `render.yaml`）
3. 创建后得到地址，形如：`https://jhd-server.onrender.com`
4. 仓库 Settings → Secrets and variables → Actions，新增：
   - Name: `VITE_WS`
   - Value: `wss://jhd-server.onrender.com`（把域名换成你的）
5. 再跑一次 Pages 工作流（Actions → Deploy GitHub Pages → Run workflow）

说明：
- 免费实例**闲置约 15 分钟会休眠**，首次进房可能要等几十秒冷启动
- 战绩落盘在容器内，休眠/重建可能丢失（够试用）
- 健康检查：`GET /api/health`

### 云服务端（Docker 自建）

```bash
docker build -t jhd-server .
docker run -p 2567:2567 jhd-server
```

HTTPS 站点必须配 `wss://`。
