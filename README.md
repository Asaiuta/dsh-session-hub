<div align="center">

# dsh-session-hub

**一个界面，管所有机器的 DSH 会话。**

多台服务器的会话汇进本机官方 Web UI —— 侧边栏零改动、对话区零替换。
顺手把 Codex CLI / Claude Code / opencode 的历史对话也接进来。

<a href="https://www.npmjs.com/package/dsh-session-hub"><img alt="npm" src="https://img.shields.io/npm/v/dsh-session-hub/alpha?style=flat-square&color=4b6fff"></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
<img alt="alpha" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square">
<img alt="node" src="https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-3c873a?style=flat-square">
<img alt="DSH" src="https://img.shields.io/badge/DSH-0.1.0--rc.6-4b6fff?style=flat-square">

</div>

> [!WARNING]
> **Alpha（`0.1.0-alpha.1`）**：核心链路已实机验证（网关路由 / 官方 UI 桥接 / 实时帧注入 / 审批应答 / 跨机对话），
> 但仅在单一环境（Windows 本机 + 腾讯云 Linux，SSH 隧道）验证过，配置格式与安全边界仍可能变化。

## 这是什么

你有好几台跑着 `dsh web` 的机器 —— 家里的、公司的、云上的。想看某台上的会话，就得开一个新标签页、连一次隧道、再从头找。

这个插件让它们**出现在同一棵树里**：

<!-- 截图占位：侧边栏（服务器分组 + 会话）。补图后替换本行 -->

```text
工作区
├── my-project        ← 本机工作区（官方原样）
├── another-repo      ← 本机工作区
├── tencent           ← 远端服务器，点开就是那台机器的会话
│   ├── 部署脚本调试
│   └── 日志分析
└── codex             ← 导入的 Codex CLI 历史对话
    └── 重构方案讨论
```

点开任意一个会话 —— 包括远端的 —— 官方对话区照常渲染：历史、逐 token 流式输出、审批卡片、提问问卷，全是官方组件。插件只搬数据，不画界面。

### 核心能力

- **🌲 远端会话进官方树**
  每台服务器成为工作区树里的一个分组。树内操作全是原生语义：**+ 新建会话** 在那台机器上创建、**归档/删除** 路由到会话所在机器、**重命名分组** = 重命名服务器、**删除分组** = 断开该连接。

- **💬 官方对话区零替换**
  远端会话的历史、实时流、审批与提问卡片全部由官方组件渲染。没有自绘聊天窗，没有 shadow slot。

- **📥 导入其他工具的会话**
  把本机 Codex CLI / Claude Code / opencode 的历史对话读进树里，按项目目录自动归入对应工作区。**按软件逐个手动开启**，未点「导入」的软件日志不会被读取。导入的会话只读；直接向它发消息会自动转成真实 DSH 会话。

- **🔑 模型配置增量同步**
  服务器连上后，把本机有而远端缺的模型提供方、默认模型与 API Key 补过去。只补缺、不覆盖远端已有配置。

- **🔌 纯 `/api` 协议实现**
  不依赖 SSH 执行命令、不做屏幕抓取、不改远端任何配置、**不在远端装任何插件**。远端就是一个未经修改的 `dsh web`。

**适合谁**：有多台 DSH 机器想统一管理的人；不想为此再开一个桌面壳或手机端的人；本机堆了一堆 Codex/Claude Code 历史对话想翻出来接着聊的人。

**不适合谁**：只有一台机器且不用外部工具的人 —— 这插件对你没有价值。

## 安装

```bash
dsh plugin --profile web add dsh-session-hub@alpha
```

装完**重启 `dsh web`**（`kill -TERM <pid>` 并等待退出，别用 `kill -9` —— 会在写入中途撕裂会话 zstd 日志），刷新页面。
**设置 → 插件** 里出现 **会话枢纽** 标签页即成功。

`dsh plugin` 把参数原样转发给 profile 目录里的 pnpm（本机需要 pnpm）。当前只有 alpha 版，`@alpha` 与不带标签装到的是同一个版本。

<details>
<summary><b>不走 npm：直接装 GitHub tarball</b></summary>

```bash
dsh plugin --profile web add https://github.com/Asaiuta/dsh-session-hub/archive/refs/tags/v0.1.0-alpha.1.tar.gz
```

仓库已提交构建产物，tarball 安装同样无需本地构建。

</details>

<details>
<summary><b>从源码安装（改代码调试）</b></summary>

```bash
git clone https://github.com/Asaiuta/dsh-session-hub && cd dsh-session-hub
npm install && npm run build
dsh plugin --profile web add file:$(pwd)
```

或手动挂载：把 `cordis.patch.yml` 的 insert 条目并入 profile 的 patch 层。

</details>

<details>
<summary><b>升级 / 禁用 / 彻底移除</b></summary>

**升级** —— 重跑 add 并重启 `dsh web`：

```bash
dsh plugin --profile web add dsh-session-hub@alpha
```

**临时禁用**：从 profile 的 bundle 列表 / `cordis.patch.yml` 移除 `dsh-session-hub` 条目后重启。
服务器注册表**保留**，重新启用即恢复。

**彻底移除**：移除条目并重启后，删掉这两个文件即可（都在 `$DSH_HOME/plugins/`）：
`dsh-session-hub.json`（服务器注册表）、`dsh-session-hub-imports.json`（导入解析缓存）。
插件从不写入你的项目目录，也不改动任何工具的原始日志。

</details>

## 环境要求

| 项 | 要求 |
|---|---|
| 本机 DSH | 实测 `@deepseek-ai/dsh@0.1.0-rc.6`；mainline 未逐 commit 跟踪 |
| Node | `^22.19 \|\| >=24`（用到内置 `WebSocket` / `fetch`） |
| 远端 DSH | 任何能应答标准 `/api` 的 `dsh web` —— **远端无需安装本插件** |
| 浏览器 | 官方 Web UI，无版本约束（插件不替换任何 UI） |

**最后验证 2026-08-14**：本机 Windows + Node v24.9.0 ↔ 远端 OpenCloudOS 9.4 + Node v24.9.0，
经 SSH 隧道跑通跨机对话、审批应答与实时流全链路。

> Alpha 期间：配置格式、路由表、`/hub/events` 帧协议在 1.0 前可能破坏性变更。

## 快速开始

**最小可复现示例：一台远端 + 本机 hub + SSH 隧道。**

**① 远端**（假设 `10.0.0.5`）—— 什么都不用装，保持默认即可：

```bash
dsh web --port 3080          # 只监听环回，这也是当前唯一允许的绑定
```

**② 本机** —— 只装插件：

```bash
dsh plugin --profile web add https://github.com/Asaiuta/dsh-session-hub/archive/refs/tags/v0.1.0-alpha.1.tar.gz
# 重启 dsh web
```

隧道不用自己建 —— 下一步填好 SSH 信息，插件会自己开、自己保活。

**③ 浏览器** `http://127.0.0.1:3080`：

1. **设置 → 插件 → 会话枢纽 → 添加服务器**，保持默认的 **SSH 隧道** 方式，填：

   | 字段 | 例 |
   |---|---|
   | 名称 | `tencent` |
   | 主机 | `10.0.0.5` |
   | SSH 用户 | `root` |
   | 私钥路径 | `~/.ssh/id_ed25519`（留空则用 ssh agent） |
   | 远端 dsh 端口 | `3080` |

   点**测试**（返回远端 DSH 版本即通）→ **添加**。本地端口由插件自行分配，你不必知道它是多少。
2. 官方工作区树里出现名为 `tencent` 的分组，远端会话就在组内；
3. 点开任一会话 —— 官方对话区照常工作：历史、实时流、审批卡片、发送 / 取消 / 重命名。

> 已经手动开着 `ssh -L` 的话，切到**直连地址**填 `http://127.0.0.1:<你的端口>` 也可以，插件不会去碰那条隧道。

<!-- 截图占位：设置 → 插件 → 会话枢纽。补图后替换本行 -->

> **为什么一定要隧道**：当前 dsh（0.1.0-rc.6）拒绝把 Web 服务绑到环回以外 —— `--host 0.0.0.0` 被 CLI 挡下
> （*"would expose remote code execution to the network"*），具体 LAN IP 连配置校验都过不了（`host` 只接受
> `127.0.0.1` 与 `0.0.0.0` 两个字面量）。所以远端保持默认，由隧道把它带到本机环回；这也意味着**不存在把 3080
> 暴露公网的选项**，上游已经先一步堵死了。
>
> 隧道进程活在 dsh 里：dsh 退出时一并关闭，启动时按保存的配置自动重建（端口每次重新分配，所以配置存的是 SSH
> 目标而不是 URL）。SSH 掉线会以退避重连，恢复后链接自动指向新端口。

### 导入本机其他工具的会话（可选）

**设置 → 插件 → 会话枢纽 → 外部会话**，按软件点「导入」：

| 软件 | 读取位置 |
|---|---|
| Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| opencode | `~/.local/share/opencode/opencode.db` |

- **未点「导入」的软件，日志一个字节都不会被读**；
- 勾选**自动**：每 60 秒增量跟进该软件新产生的会话；不勾选就只在你点刷新时更新；
- **移除**：把该软件的会话撤出树，不影响其他软件，也不动原始日志；
- 导入的会话在树里**只读**；直接向它发消息会自动转成真实 DSH 会话（保留用户/助手对话，原只读副本隐藏）。

## 配置

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `dataFile` | `string?` | `$DSH_HOME/plugins/dsh-session-hub.json` | 服务器注册表持久化位置 |
| `trustedHosts` | `string[]?` | 仅环回 | 网关拦截的 `/api` 再校验白名单（裸 `host[:port]`，格式同 `client-connection.trustedHosts`；SSH 隧道部署无需配置） |

在 profile 的 `cordis.yml` / `cordis.patch.yml` 中配置：

```yaml
- id: dsh-session-hub
  config:
    dataFile: /srv/dsh-hub-servers.json
    trustedHosts: ['192.168.1.10:3080']
```

唯一相关的环境变量是 `DSH_HOME`（影响注册表默认路径，默认 `~/.dsh`）—— 插件不需要任何 API key 或令牌环境变量。
运行期 `/hub/events` 用的随机 token 每进程生成一次，只经快照下发给浏览器，不落盘。

## 它访问什么

一句话：**读你本机的会话日志（需你逐个授权）、和你配置的服务器通信、不碰你的项目文件**。

<details>
<summary><b>完整清单（文件 / 网络 / 凭据 / 会话内容）</b></summary>

**文件访问**：
- 读/写 `$DSH_HOME/plugins/dsh-session-hub.json`（`0600`，原子写：tmp + rename）；
- 读/写 `$DSH_HOME/plugins/dsh-session-hub-imports.json`（导入会话解析缓存，`0600`）；
- 只读扫描本机会话日志：`~/.codex/sessions/**/rollout-*.jsonl`、`~/.claude/projects/**/*.jsonl`、`~/.local/share/opencode/opencode.db`（SQLite 只读打开），用于生成**只读**的导入会话视图；绝不写回这些文件。**按软件逐个手动导入**：未在设置里点「导入」的软件，其日志不会被读取。

**网络**：
- 出站（对每个已配置服务器 `baseUrl`）：HTTP `POST /api/*`（unary RPC）+ WebSocket 升级 `/api/events.mux`、`/api/events.host`；
- 入站（本机进程内）：`/hub/events` SSE（仅环回 Host + 随机 token + 浏览器 same-origin 三重校验）、Typert `/api/sessionHub/*`（环回）；
- 入站（浏览器）：被拦截的 `/api/session.*` 与 `/api/respond` 会经网关再校验环回/`trustedHosts`。

**SSH 密钥**：SSH 隧道条目会按你填写的路径读取私钥（仅用于建立那条隧道），密钥内容不落盘、不外传、不写进插件配置 —— 配置里只存路径。留空则走 ssh agent，插件完全不接触密钥材料。

**凭据**：模型同步功能会读取本机 `$DSH_HOME/.credentials.yaml` 明文（仅用于提取 `llm-*` 命名空间 `apiKeyEnv` 引用的密钥值），并在**远端未配置**该引用时经 `credentials.set` 写入远端（唯一的密钥出站方向，隧道/HTTPS 下加密）。密钥从不随响应回传，hub 也不落盘密钥副本。若不想自动推送密钥，可在服务器配置中不启用模型同步（或拆掉该服务器的 `llm-*` 命名空间）。

**用户数据**：远端会话列表、历史内容、实时流会经由 hub 进程与浏览器中转显示——跨机传输走 SSH 隧道（加密，也是目前唯一的连接方式）；我方不明文落盘任何会话内容。

</details>

## 常见问题

| 症状 | 原因 / 处理 |
|---|---|
| 添加服务器报 `self-loop` | baseUrl 指向 hub 自身。插件启动时也会自动检测并跳过自环条目（日志 warn） |
| 历史加载失败 `signal timed out` | 最常见：SSH 隧道断了。检查 `netstat -ano \| grep :3333`；重启隧道后远端自动重连 |
| 历史加载失败 `invalid_value … expected "server-response"` | 旧版本网关直通缺陷，**升级到 0.1.0-alpha.1+**（已修复：出口统一补 `type: 'server-response'`） |
| 会话列表少了一项 | 冷启动后远端首个 `session.list` 拉取未完成；打开会话本身会触发重拉 |
| 实时流断开（LIVE 徽标变灰） | SSE 自动重连；发送后 900ms 无实时事件自动回退历史重载 |
| 插件未生效 | 检查 `dsh plugin` 后是否重启 web；看启动日志有无 `dsh-session-hub` 加载与 gateway 使能信息 |

**日志位置**：`dsh web` 进程 stdout/stderr——systemd 部署 `journalctl -u dsh-web`，nohup 部署看输出文件；本地终端部署看控制台。

**回滚**：`dsh plugin --profile web add dsh-session-hub@<上一版本>` 并重启即可。注册表文件向后兼容（未知字段忽略），降级不会丢配置。

## 开发

```bash
git clone https://github.com/Asaiuta/dsh-session-hub && cd dsh-session-hub
npm install          # devDeps：esbuild / typescript / zod / react
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm run build        # esbuild → lib/index.js + lib/client.js + lib/types/
```

- 类型检查走仓库自带 `stubs/`（按 harness 源码抄写的最小声明面，经 tsconfig `paths` 映射）；对真实 DSH checkout 构建可删 `paths`/`stubs`、把 `@deepseek-ai/*` 引回 `link:` devDeps（参考 dsh-interconnect）。
- `@deepseek-ai/dsh-*` 未发布到 npm，运行时由 profile 提供（peerDeps 因此全部 optional）。
- **测试**：当前无自动化套件；冒烟路径（网关合并去重、SSE 三重鉴权、跨机实时对话、审批应答、self-loop 拒绝）为实机手动验证。欢迎贡献测试与 PR。

## 许可证与安全

- License：**[MIT](./LICENSE)**。
- 安全边界见上方「它访问什么」；设计不变量——不中继特权域、审批一律人工应答（插件不做自动放行）、自环/未授权源一律拒绝。
- **私密报告**：请通过 [GitHub Issues](https://github.com/Asaiuta/dsh-session-hub/issues) 提交（标注 `[security]`），或直接联系维护者 [@Asaiuta](https://github.com/Asaiuta)；修复前不会公开细节。

---

## 架构

```
┌──────────────────────── 本地 DSH 进程 ────────────────────────┐
│  host 插件 (src/index.ts → hub/)                              │
│                                                               │
│  ServerRegistry ──持久化── $DSH_HOME/plugins/dsh-session-hub.json│
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
│  SSE /hub/events（随机 token + 环回 + same-origin 三重围栏）    │
└──────────────┬────────────────────────────────────────────────┘
               │ 官方 /api unary（浏览器→网关→路由）
               │ SSE 远端 mux 帧（原样转发）
┌──────────────▼────────────────────────────────────────────────┐
│  browser：官方 UI（零替换 / 零 shadow）                         │
│  · 官方工作区树：/api/session.list 由网关合并 → 远端会话直接     │
│    出现在官方树；点击打开                                      │
│  · 官方对话区：远端会话 open() 走 /api/session.history 网关路由，│
│    实时 mux 帧由 client 桥 (startOfficialBridge) 注入官方       │
│    sessions.handleMuxEnvelope → 官方逐 token 流式渲染/审批卡   │
│  · 设置 → 插件 → Session Hub：服务器增删/状态/探活、远端新建    │
└────────────────────────────────────────────────────────────────┘
```

**实时通道**：每条远端链路的 mux/host WS 帧经 `HubEventBus` fan-out 到本地 SSE `/hub/events`；浏览器按 `event.seq` 与历史基线去重（打开会话先拉尾部历史，live 事件缓冲后按 `seq > tailSeq` 应用），`assistant/chunk` 增量折叠逐 token 气泡，审批/提问帧到达即上卡；SSE 断线自动重连。