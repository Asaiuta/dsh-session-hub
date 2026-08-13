# dsh-session-hub

> ⚠️ **Alpha** — 0.1.0-alpha.1：协议与 API 仍在演进，核心链路（网关路由 / 官方 UI 桥接 / 实时帧注入）已实机验证，但配置格式与安全边界可能变化。

**在单个 DSH Web UI 里聚合并原生操控多台 DeepSeek Harness 服务器的会话。**

这个插件把若干台远端 `dsh web` 部署的会话聚合到一个面板中：服务器管理、合并的会话树、会话历史/发送/取消/重命名/派生、模型选择、以及远端审批/提问的应答——全部通过 DSH 自有的 `/api` 协议原生完成，不依赖 SSH、不做屏幕抓取、不改远端任何配置。

## 为什么可行（协议分析）

DSH 的 Web 传输层本身就是一个完整的远程控制协议（`client-connection` 包 + `host-apiproxy` 包）：

- **上行**：`POST /api/<method>`，JSON 信封 RPC。会话域方法齐备：`session.list / history / prompt / cancel / rename / fork / create / models / selectModel / updateQueue / attachment / search`，加上 `host.describe` 与应答通道 `POST /api/respond`。
- **下行**：WS 升级 `/api/events.mux` 与 `/api/events.host` 两条事件流——官方浏览器客户端、orbis 手机客户端、dsh-desktop 桌面客户端都走同一协议。
- **信任围栏**（`api-request-trust.ts`）：Node 客户端不携带 Origin / Sec-Fetch-*，只要 `Host` 头是环回地址（SSH 隧道）或远端 `trustedHosts`/CLI 派生的 LAN IP 字面量即可通过；会话类方法均为**非特权**方法（只有 settings/credentials/目录选择器固定在环回）。因此本插件的 Node 端可以直连任意远端的标准 `/api`。
- **应答交互**：远端 mux 流推送 `approval/requested` / `question/requested` 帧（带稳定 rpcId），本插件捕获后经本地 UI 呈现，用户的批准/回答通过 `POST /api/respond` 回填远端——与官方浏览器完全同构。

## 架构

```
┌──────────────────────── 本地 DSH 进程 ────────────────────────┐
│  host 插件 (src/index.ts → hub/)                              │
│                                                               │
│  ServerRegistry ──持久化── ~/.dsh/plugins/dsh-session-hub.json │
│   │ 每个 ServerLink ── RemoteApiClient(AbstractApiClient)     │
│   │  · HTTP unary → 远端 /api/session.*                        │
│   │  · WS mux/host 双流 + 指数退避重连                         │
│   │  · 会话列表缓存 / pending 交互表 (rpcId→服务器索引)         │
│   ├── HubGateway（exact 路由优先于官方 /api prefix）           │
│   │    接管 session.list/history/prompt/cancel/rename/fork/    │
│   │    models/selectModel/updateQueue/attachment/search/respond│
│   │    按会话归属路由：远端 → ServerLink，本地 → 官方 ApiProxy  │
│   │    session.list 合并去重（官方 items + 远端 rows）          │
│   └── SessionHubRuntime (TypertRemoteService @Remote)          │
│        暴露 wire 命名空间 sessionHub（服务器管理/远端建会话）   │
│  SSE /hub/events（token + 环回 + same-origin 围栏）            │
└──────────────┬────────────────────────────────────────────────┘
               │ 官方 /api unary（浏览器→网关→路由）
               │ SSE 远端 mux 帧（原样转发）
┌──────────────▼────────────────────────────────────────────────┐
│  browser：官方 UI（零替换）                                    │
│  · 官方工作区树：/api/session.list 由网关合并 → 远端会话直接    │
│    出现在官方树（未归档区）；点击打开                          │
│  · 官方对话区：远端会话 open() 走 /api/session.history 网关路由，│
│    实时 mux 帧由 client 桥 (startOfficialBridge) 注入官方       │
│    sessions.handleMuxEnvelope → 官方逐 token 流式渲染/审批卡   │
│  · 侧边栏底部 SESSION-HUB 区块（官方树零改动）：服务器增删/     │
│    状态/探活、远端新建会话                                     │
└────────────────────────────────────────────────────────────────┘
```
## 使用方法

1. 在每台远端服务器上运行 `dsh web`（`--host 0.0.0.0` 由 CLI 自动推导 LAN IP 白名单；更推荐 SSH 反向隧道把远端 `3080` 映射到本地 `127.0.0.1:xxxx`，此时天然通过环回信任围栏）。
2. 把插件安装进本地 DSH profile（`dsh plugin <profile> add dsh-session-hub`，或 bundle patch 方式挂载 `cordis.patch.yml`）。
3. 打开 Web UI：侧边栏即是服务器目录（每台机器一个目录项，自动展开，本机也在其中），点右上「添加服务器」：名称 + `http://<host>:<port>` → 测试 → 添加。
4. 点击目录下任一会话：主区域打开对话——查看历史、发消息、取消、重命名、派生；远端 Agent 请求审批/提问时对话顶部出现应答卡片。

## 开发

```
git clone <repo> && cd dsh-session-hub
# 需要一份 DSH checkout（用于类型链接）, 例如 ../dsh
pnpm install            # devDeps 用 link: 指向 ../dsh/...（见 package.json）
pnpm run build          # esbuild 产出 lib/index.js + lib/client.js + .d.ts
pnpm run typecheck
```

> 本仓库附带的 `stubs/` 与 tsconfig `paths` 是**无 DSH checkout 时的类型占位**（按 harness 源码抄写的最小声明面）；对真实 checkout 构建时请删除 `paths`/`stubs` 并改用 `link:` devDeps。

### 实时对话通道（已实现）

- 每条远端链路的 mux/host WS 帧经 `HubEventBus` fan-out 到本地 SSE 路由 `/hub/events`；
- 浏览器 `EventSource` 订阅：`assistant/chunk`（text/reasoning/tool-call delta、block-start/end）增量折叠出逐 token 的回复气泡，`user/message` 立即回显，`tool/call`、`tool/result` 实时上屏，`assistant/message` 终结定型；
- 与历史按 `event.seq` 去重：打开会话先拉尾部历史作基线，期间的 live 事件先缓冲、基线落地后按 `seq > tailSeq` 应用，不漏帧不重帧；
- 审批/提问帧到达即上卡；任何帧触发快照 250ms 短防抖刷新；SSE 断线自动重连，发送后 900ms 无实时事件则回退历史重载。

### v1 范围与后续

- v1：文本消息（queue 模式）实时对话；含附件（`session.attachment`）需要图片拾取，未接入。
- 后续：`session.search` 跨服务器检索、queue 编辑（`session.updateQueue`）、模型目录/选择 UI（`session.models`+`selectModel`）、Typert events 事件订阅。

## 安全边界

- 插件端点只通过 Typert Remote 暴露给环回 Web 客户端；`/hub/events` SSE 要求每注册表实例随机 token（随快照下发）+ 环回 Host + （浏览器必带的）same-origin Origin 三重校验，DNS rebinding / 跨站读取 / 无 token 直连均被拒；远端服务器也只接受其自身信任围栏允许的调用方（默认环回/局域网 IP 字面量）。
- 服务器注册表以 `0600` 权限存于 `$DSH_HOME/plugins/`，不含凭据。
- 审批一律人工应答，插件不做自动放行。
- 不中继 settings/credentials 域（官方固定在环回，插件也不暴露）。

## 授权

MIT — 见 [LICENSE](./LICENSE)。