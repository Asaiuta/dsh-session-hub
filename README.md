<div align="center">

# dsh-session-hub

**把散在各处的会话收进 DSH 的同一棵树。**

远端服务器上的 DSH 会话，本机 Codex CLI、Claude Code、opencode、Pi 的历史对话，
一起进官方 Web UI。侧边栏和对话区都用官方的，插件只搬数据。两件事互相独立，可以只装一件。

<a href="https://www.npmjs.com/package/dsh-session-hub"><img alt="npm" src="https://img.shields.io/npm/v/dsh-session-hub/alpha?style=flat-square&color=4b6fff"></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
<a href="CHANGELOG.md"><img alt="changelog" src="https://img.shields.io/badge/changelog-alpha.2-8957e5?style=flat-square"></a>
<img alt="alpha" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square">
<img alt="node" src="https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-3c873a?style=flat-square">
<img alt="DSH" src="https://img.shields.io/badge/DSH-0.1.0--rc.6-4b6fff?style=flat-square">

</div>

> [!WARNING]
> Alpha 版本（`0.1.0-alpha.2`，[本版改动](CHANGELOG.md)）。核心链路都在真机上跑通过：网关路由、官方 UI 桥接、
> 实时帧注入、审批应答、跨机对话。但只验证过一套环境（Windows 本机 + 腾讯云 Linux，SSH 隧道），
> 配置格式和安全边界在 1.0 前仍可能变。

## 这是什么

DSH 的会话树只认这一台机器、这一个工具产生的会话。于是：

服务器上跑了一半的任务，要开新标签页、连隧道、从头找起。关掉笔记本再回来，不知道它现在到哪一步。
上周用 Codex CLI 聊过的方案，在 DSH 里根本不存在，只能去翻 `~/.codex` 底下的 JSONL。

这个插件把这两类会话都接进同一棵树：

<!-- 截图占位：侧边栏（服务器分组 + 会话）。补图后替换本行 -->

```text
工作区
├── my-project        ← 本机工作区（官方原样）
├── another-repo      ← 本机工作区
├── tencent           ← 远端服务器，点开就是那台机器的会话
│   ├── 部署脚本调试
│   └── 日志分析
└── audio-engine      ← 本机工作区，混着导入的历史对话
    ├── 重构方案讨论        (Codex CLI)
    └── 修 CI 那次          (Claude Code)
```

点开任意一个会话，包括远端的，官方对话区照常渲染：历史、逐 token 流式输出、审批卡片、提问问卷，
全是官方组件。插件只搬数据，不画界面。

远端会话并不是你本机在代跑。agent 循环在那台机器自己的 `dsh` 里，本机只是个看板。
所以可以关掉本机去吃饭，回来再接上看它跑到哪了：还在跑就从当前这一刻续上实时流，跑完了就看完整历史。

### 两件独立的事

插件做两件事。它们不互相依赖，**装了可以只开一件**（见[配置](#配置)）：

### 两件独立的事

插件做两件事，互相不依赖，装了可以只开一件（见[配置](#配置)）：

#### 🖧 把远端机器接进来

每台服务器成为工作区树里的一个分组，组内是那台机器的会话。

- 树内操作是原生语义：**+ 新建会话**在那台机器上创建、**归档 / 删除**路由到会话所在机器、**重命名分组**即重命名服务器、**删除分组**即断开该连接。
- 会话跑在远端，不依赖你开着：agent 循环在那台机器自己的 `dsh` 里推进。本机关掉、断网、换台电脑，远端该跑的照跑。回来时它可能已经跑完了。
- 中途接得上：hub 启动时若远端正在生成，从当前这一刻续上实时流，缺席期间的历史由 `session.history` 补齐，和官方断线重连是同一套语义。
- 对话区零替换：远端会话的历史、实时流、审批与提问卡片全部由官方组件渲染。没有自绘聊天窗，没有 shadow slot。
- 隧道不用你建：填 `user@host` 与私钥路径，插件自己开 SSH 隧道、自己保活重连，本地端口它自己分配。
- 模型配置增量同步：服务器连上后，把本机有而远端缺的提供方、默认模型与 API Key 补过去。只补缺，不覆盖远端已有配置。

#### 📥 把其他工具的历史接进来

本机 Codex CLI / Claude Code / opencode 聊过的对话，按项目目录归入对应工作区。

- 按软件逐个手动开启，未点「导入」的软件日志一个字节都不会被读；
- 找不到对应工作区的项目会自动建成真实工作区（只登记，不创建目录）；目录已不存在的会话自动隐藏；
- 导入的会话在树里只读；直接向它发消息会自动转成真实 DSH 会话（保留用户/助手对话，原只读副本隐藏）；
- 源日志只读打开，从不改写、从不删除。

#### 两件事共用的底子

- 纯 `/api` 协议：不靠 SSH 执行命令、不做屏幕抓取、不改远端配置，远端不装任何插件，就是一个未经修改的 `dsh web`。
- 官方 UI 零改动：不替换侧边栏、不替换对话区。插件只在数据层做合并与路由。

**只有一台机器？** 第二件事照样成立：不填任何服务器，只开导入，把本机 Codex / Claude Code / opencode 的历史接进来即可。

## 安装

```bash
dsh plugin --profile web add dsh-session-hub@alpha
```

装完重启 `dsh web`（`kill -TERM <pid>` 并等待退出，别用 `kill -9`，会在写入中途撕裂会话 zstd 日志），刷新页面。
**设置 → 插件** 里出现 **会话枢纽** 标签页即成功。

`dsh plugin` 把参数原样转发给 profile 目录里的 pnpm（本机需要 pnpm）。当前只有 alpha 版，`@alpha` 与不带标签装到的是同一个版本。

<details>
<summary><b>不走 npm：直接装 GitHub tarball</b></summary>

```bash
dsh plugin --profile web add https://github.com/Asaiuta/dsh-session-hub/archive/refs/tags/v0.1.0-alpha.2.tar.gz
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

**升级**：重跑 add 并重启 `dsh web`：

```bash
dsh plugin --profile web add dsh-session-hub@alpha
```

**临时禁用**：从 profile 的 bundle 列表 / `cordis.patch.yml` 移除 `dsh-session-hub` 条目后重启。
服务器注册表保留，重新启用即恢复。

**彻底移除**：移除条目并重启后，删掉这两个文件即可（都在 `$DSH_HOME/plugins/`）：
`dsh-session-hub.json`（服务器注册表）、`dsh-session-hub-imports.json`（导入解析缓存）。
插件从不写入你的项目目录，也不改动任何工具的原始日志。

</details>

## 环境要求

| 项 | 要求 |
|---|---|
| 本机 DSH | 实测 `@deepseek-ai/dsh@0.1.0-rc.6`；mainline 未逐 commit 跟踪 |
| Node | `^22.19 \|\| >=24`（用到内置 `WebSocket` / `fetch`） |
| Profile | 仅 `web`：插件 inject `webServer` / `apiProxy`，装进 `headless` / `tui` 会一直 pending 并导致该 profile 启动失败 |
| 浏览器 | 官方 Web UI，无版本约束（插件不替换任何 UI） |
| 远端 DSH | 仅接远端时需要：任何能应答标准 `/api` 的 `dsh web`，远端无需安装本插件 |
| 外部工具 | 仅导入时需要：本机装过 Codex CLI / Claude Code / opencode / Pi 中的任意一个，读它们默认的日志位置 |

**最后验证 2026-08-14**：
远端侧，本机 Windows + Node v24.9.0 对远端 OpenCloudOS 9.4 + Node v24.9.0，经 SSH 隧道跑通跨机对话、审批应答与实时流全链路；
导入侧，本机解析 615 个会话（Codex 523 / Claude Code 67 / opencode 25），归入 21 个工作区，只读会话转真实会话已验证。

> Alpha 期间：配置格式、路由表、`/hub/events` 帧协议在 1.0 前可能破坏性变更。

## 快速开始

装完插件后按你要的那件事往下走，两条路互不依赖：

- 只想把本机 Codex / Claude Code / opencode 的历史接进来，直接跳到[导入本机其他工具的会话](#导入本机其他工具的会话)，三次点击就完事，不用配服务器、不用隧道。
- 想接远端机器，从下面这个最小示例开始。

### 接一台远端机器

**最小可复现示例：一台远端 + 本机 hub + SSH 隧道。**

**① 远端**（假设 `10.0.0.5`），什么都不用装，保持默认即可：

```bash
dsh web --port 3080          # 只监听环回，这也是当前唯一允许的绑定
```

**② 本机**，只装插件：

```bash
dsh plugin --profile web add https://github.com/Asaiuta/dsh-session-hub/archive/refs/tags/v0.1.0-alpha.2.tar.gz
# 重启 dsh web
```

隧道不用自己建，下一步填好 SSH 信息，插件会自己开、自己保活。

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
3. 点开任一会话，官方对话区照常工作：历史、实时流、审批卡片、发送 / 取消 / 重命名。

> 已经手动开着 `ssh -L` 的话，切到**直连地址**填 `http://127.0.0.1:<你的端口>` 也可以，插件不会去碰那条隧道。

<!-- 截图占位：设置 → 插件 → 会话枢纽。补图后替换本行 -->

> **为什么一定要隧道**：当前 dsh（0.1.0-rc.6）拒绝把 Web 服务绑到环回以外。`--host 0.0.0.0` 被 CLI 挡下
> （*"would expose remote code execution to the network"*），具体 LAN IP 连配置校验都过不了（`host` 只接受
> `127.0.0.1` 与 `0.0.0.0` 两个字面量）。所以远端保持默认，由隧道把它带到本机环回；这也意味着不存在把 3080
> 暴露公网的选项，上游已经先一步堵死了。
>
> 隧道进程活在 dsh 里：dsh 退出时一并关闭，启动时按保存的配置自动重建（端口每次重新分配，所以配置存的是 SSH
> 目标而不是 URL）。SSH 掉线会以退避重连，恢复后链接自动指向新端口。

### 导入本机其他工具的会话

不需要任何服务器或隧道。打开 **设置 → 插件 → 会话枢纽 → 外部会话**，按软件点「导入」：

| 软件 | 读取位置 |
|---|---|
| Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| opencode | `~/.local/share/opencode/opencode.db` |
| Pi Coding Agent | `~/.pi/agent/sessions/**/*.jsonl` |

- 未点「导入」的软件，日志一个字节都不会被读；
- 勾选**自动**：60 秒周期扫描 + 导入时增量解析跟进新写入的日志，不勾选就只在你点刷新时更新；
- 导入的会话在树里只读，**工具调用（参数、结果、错误标记）以真实工具卡片显示**，文本与卡片按源日志顺序排列，卡片的 call id / 参数 / 输出均取自原始记录，不合成；
- **移除**：把该软件的会话撤出树，不影响其他软件，也不动原始日志；
- 导入的会话在树里只读；直接向它发消息会自动转成真实 DSH 会话（保留用户/助手对话和工具调用，原只读副本隐藏）。

## 配置

四个功能开关默认全开，装完即用。只要其中一件时把另一件关掉：

```yaml
# 只要导入，不要多服务器（单机用户的典型配置）
- id: dsh-session-hub
  config:
    features:
      aggregate: false
      tunnel: false
      modelSync: false
```

```yaml
# 只要多服务器，不碰本机其他工具的日志
- id: dsh-session-hub
  config:
    features:
      importer: false
```

关闭等于不存在，不是闲置：关掉的功能不构造服务、不读缓存、不扫目录、不注册路由，也不在设置页出现。
四个全关时插件等于没装（不拦截任何 `/api`）。

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `dataFile` | `string?` | `$DSH_HOME/plugins/dsh-session-hub.json` | 服务器注册表持久化位置 |
| `trustedHosts` | `string[]?` | 仅环回 | 网关拦截的 `/api` 再校验白名单（裸 `host[:port]`，格式同 `client-connection.trustedHosts`；SSH 隧道部署无需配置） |
| `features.aggregate` | `boolean` | `true` | 多服务器聚合：关闭后不注册 `/api` 拦截、不建虚拟分组，服务器卡片从设置里消失 |
| `features.tunnel` | `boolean` | `true` | SSH 隧道托管：关闭后添加表单只剩直连地址，已保存的 SSH 条目会被跳过并在日志里说明 |
| `features.modelSync` | `boolean` | `true` | 模型配置同步：关闭后不读本机凭据、不推送远端，同步卡片消失 |
| `features.importer` | `boolean` | `true` | 外部会话导入：关闭后不读解析缓存、不扫描日志目录，导入卡片消失（缓存文件保留，重新开启即恢复） |

在 profile 的 `cordis.yml` / `cordis.patch.yml` 中配置：

```yaml
- id: dsh-session-hub
  config:
    dataFile: /srv/dsh-hub-servers.json
    trustedHosts: ['192.168.1.10:3080']
```

唯一相关的环境变量是 `DSH_HOME`（影响注册表默认路径，默认 `~/.dsh`）。插件不需要任何 API key 或令牌环境变量。
运行期 `/hub/events` 用的随机 token 每进程生成一次，只经快照下发给浏览器，不落盘。

## 它访问什么

读你本机的会话日志（需你逐个授权）、和你配置的服务器通信、不碰你的项目文件。

下面每一项都只在对应功能开着时才发生：关掉导入就不读任何日志，关掉聚合就不发起任何出站连接。

<details>
<summary><b>完整清单（文件 / 网络 / 凭据 / 会话内容）</b></summary>

**文件访问**：
- 读/写 `$DSH_HOME/plugins/dsh-session-hub.json`（`0600`，原子写：tmp + rename）；
- 读/写 `$DSH_HOME/plugins/dsh-session-hub-imports.json`（导入会话解析缓存，`0600`）；
- 只读扫描本机会话日志：`~/.codex/sessions/**/rollout-*.jsonl`、`~/.claude/projects/**/*.jsonl`、`~/.local/share/opencode/opencode.db`（SQLite 只读打开）、`~/.pi/agent/sessions/**/*.jsonl`，用于生成**只读**的导入会话视图；绝不写回这些文件。**按软件逐个手动导入**：未在设置里点「导入」的软件，其日志不会被读取。

**网络**：
- 出站（对每个已配置服务器 `baseUrl`）：HTTP `POST /api/*`（unary RPC）+ WebSocket 升级 `/api/events.mux`、`/api/events.host`；
- 入站（本机进程内）：`/hub/events` SSE（仅环回 Host + 随机 token + 浏览器 same-origin 三重校验）、Typert `/api/sessionHub/*`（环回）；
- 入站（浏览器）：被拦截的 `/api/session.*` 与 `/api/respond` 会经网关再校验环回/`trustedHosts`。

**SSH 密钥**：SSH 隧道条目会按你填写的路径读取私钥（仅用于建立那条隧道），密钥内容不落盘、不外传、不写进插件配置，配置里只存路径。留空则走 ssh agent，插件完全不接触密钥材料。

**凭据**：模型同步功能会读取本机 `$DSH_HOME/.credentials.yaml` 明文（仅用于提取 `llm-*` 命名空间 `apiKeyEnv` 引用的密钥值），并在**远端未配置**该引用时经 `credentials.set` 写入远端（唯一的密钥出站方向，隧道/HTTPS 下加密）。密钥从不随响应回传，hub 也不落盘密钥副本。若不想自动推送密钥，可在服务器配置中不启用模型同步（或拆掉该服务器的 `llm-*` 命名空间）。

**用户数据**：远端会话列表、历史内容、实时流会经由 hub 进程与浏览器中转显示。跨机传输走 SSH 隧道（加密，也是目前唯一的连接方式）；我方不明文落盘任何会话内容。

</details>

## 和其他插件共存

生态里已经有 1800+ 个 dsh 插件，其中不少也改前端。这个插件改的是数据层，不是画面层：

| 层 | 谁在改 | 冲突吗 |
|---|---|---|
| 会话/工作区**数据** | 本插件（网关合并 `session.list` / `workspace.list`） | 与 UI 插件不冲突 |
| 侧边栏/对话区**画面** | 各类 UI 插件（换树、换主题、加 Tab） | 本插件一个都不占 |

本插件在浏览器侧只做一件事：往 `settings.plugins.tab` 这个 **list 槽**加一个 `id: 'session-hub'` 的条目。
不 shadow `sidebar.workspaces`，不 shadow `conversation`，不碰任何单槽，所以换侧边栏、换对话区、换主题的插件都能与它并存。

换树的插件反而会自动显示远端与导入的会话：它们通过官方 `useSessions` / `useWorkspaces` 取数，
而这两个 hook 的上游正是本插件合并过的 `/api`。例如 `dsh-plugin-ya-workspace-sidebar` 完整替换了
`sidebar.workspaces`，本插件的服务器分组和导入会话照样出现在它画的树里，双方互不知情。

<details>
<summary><b>唯一的冲突：也拦截 <code>/api</code> 的插件</b></summary>

DSH 的 web server 对同一条 exact 路径只允许一个注册者（重复注册直接抛错，这是刻意的组合约定）。
本插件为实现会话合并，接管了这些路径：

```
/api/session.list      /api/session.history   /api/session.prompt    /api/session.cancel
/api/session.rename    /api/session.fork      /api/session.models    /api/session.selectModel
/api/session.updateQueue  /api/session.attachment  /api/session.search  /api/session.create
/api/workspace.list    /api/workspace.rename  /api/workspace.delete  /api/workspace.archiveSession
/api/respond
```

另一个插件若也拦截其中任意一条，本插件会让出已占的路由并降级，`dsh` 与对方插件照常运行：

```
[dsh-session-hub] gateway DISABLED — webserver: duplicate exact route "/api/respond".
Another plugin intercepts the same route, so remote servers and imported sessions will not appear.
Set features.aggregate and features.importer to false to silence this, or remove the conflicting plugin.
```

此时远端会话与导入会话不会出现（这两项功能依赖那些路由），但 DSH 本身、对方插件、以及本插件的设置页都正常。
把 `features.aggregate` 与 `features.importer` 设为 `false` 可消除这条告警。

> 这条路径实机验证过：用一个抢占 `/api/respond` 的测试插件复现，`dsh` 首页仍 `200`、官方 `session.list` 正常应答、
> `sessionHub` 端点存活，路由撞车不会拖垮宿主。

绝大多数插件不走这条路：加工具、加技能、加 UI、加 Tab 都不需要拦截 `/api`。

</details>

**Typert 命名空间**：本插件独占 `sessionHub`（对应 `/api/sessionHub/*`），SSE 独占 `/hub/events`。命名空间撞车的可能性极低。

### 和 `dsh-remote` 的分界

[`dsh-remote`](https://github.com/flymysql/dsh-remote) 同样做“远程”，但做的是另一件事。两者技术上不冲突（它占 `/dsh-remote/*` 与工作区选择器槽，我们占 `/api/*` 与设置页 Tab，实机同装验证过），可以一起装。

区别在于 agent 循环在谁家跑：

| | `dsh-remote` | `dsh-session-hub` |
|---|---|---|
| 远端需要什么 | 只要 `sshd` | 一个跑着的 `dsh web` |
| 谁在干活 | 本机的 agent，通过 SSH 伸手过去 | 远端自己的 agent |
| 会话存在哪 | 都在本机 | 各机器自己的 `~/.dsh` |
| 本机关机后 | 任务停了 | 远端继续跑 |
| 别人在远端发起的会话 | 看不到（远端没有会话） | 树里直接出现 |

选型规则：

> 远端能装 dsh → 本插件（远端自己有会话，你去聚合）
> 远端只有 sshd → `dsh-remote`（本机伸手过去操作）

客户的生产机、不允许装东西的跳板机，适合用 `dsh-remote`。而想要“关机之后任务继续跑”，则必须让远端自己有一个 `dsh`。

## 常见问题

| 症状 | 原因 / 处理 |
|---|---|
| 添加服务器报 `self-loop` | baseUrl 指向 hub 自身。插件启动时也会自动检测并跳过自环条目（日志 warn） |
| 历史加载失败 `signal timed out` | 最常见：SSH 隧道断了。检查 `netstat -ano \| grep :3333`；重启隧道后远端自动重连 |
| 历史加载失败 `invalid_value … expected "server-response"` | 旧版本网关直通缺陷，升级到 0.1.0-alpha.1+（已修复：出口统一补 `type: 'server-response'`） |
| 会话列表少了一项 | 冷启动后远端首个 `session.list` 拉取未完成；打开会话本身会触发重拉 |
| 实时流断开（LIVE 徽标变灰） | SSE 自动重连；发送后 900ms 无实时事件自动回退历史重载 |
| 本机关了一阵子，远端会话现在怎么看 | 直接点开就行。远端还在跑就从当前这一刻续上实时流，缺席那段由历史补齐；已跑完则直接看到完整结果 |
| 远端明明停了，UI 还在转圈 | 0.1.0-alpha.2 之前的缺陷：`host/session-status` 帧送错了入口被丢弃。升级即可；临时解法是刷新页面 |
| 插件未生效 | 检查 `dsh plugin` 后是否重启 web；看启动日志有无 `dsh-session-hub` 加载与 gateway 使能信息 |
| 点了「导入」但树里没有 | 该软件的会话所属项目目录已不存在，目录不在磁盘上的会话会被自动隐藏；恢复目录后一个扫描周期内回来 |
| 导入的会话发不出消息 | 正常：导入会话只读。直接发送会自动转成真实 DSH 会话，之后照常对话 |
| 某个软件显示「未安装」 | 只按默认路径查找（`~/.codex` / `~/.claude` / `~/.local/share/opencode` / `~/.pi`）；装在别处目前无法指定 |
| 移除某个软件后别的也少了 | 0.1.0-alpha.1 之前的缺陷（跨源误删），升级即可 |

**日志位置**：`dsh web` 进程 stdout/stderr（systemd 部署看 `journalctl -u dsh-web`，nohup 部署看输出文件，本地终端部署看控制台）。

**回滚**：`dsh plugin --profile web add dsh-session-hub@<上一版本>` 并重启即可。注册表文件向后兼容（未知字段忽略），降级不会丢配置。
各版本的破坏性变更与降级注意事项见 [CHANGELOG](CHANGELOG.md)。

## 开发

```bash
git clone https://github.com/Asaiuta/dsh-session-hub && cd dsh-session-hub
npm install          # devDeps：esbuild / typescript / zod / react
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm run build        # esbuild → lib/index.js + lib/client.js + lib/types/
```

- 类型检查走仓库自带 `stubs/`（按 harness 源码抄写的最小声明面，经 tsconfig `paths` 映射）；对真实 DSH checkout 构建可删 `paths`/`stubs`、把 `@deepseek-ai/*` 引回 `link:` devDeps（参考 dsh-interconnect）。
- `@deepseek-ai/dsh-*` 未发布到 npm，运行时由 profile 提供（peerDeps 因此全部 optional）。
- 测试：当前无自动化套件；冒烟路径（网关合并去重、SSE 三重鉴权、跨机实时对话、审批应答、self-loop 拒绝）为实机手动验证。欢迎贡献测试与 PR。

## 许可证与安全

- License：[MIT](./LICENSE)。
- 安全边界见上方「它访问什么」；设计不变量：不中继特权域、审批一律人工应答（插件不做自动放行）、自环/未授权源一律拒绝。
- 私密报告：请通过 [GitHub Issues](https://github.com/Asaiuta/dsh-session-hub/issues) 提交（标注 `[security]`），或直接联系维护者 [@Asaiuta](https://github.com/Asaiuta)；修复前不会公开细节。

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
│   │    + workspace.list/rename/delete/archiveSession           │
│   │    按会话归属三路分派：远端 → ServerLink、导入 → ImportStore│
│   │    、本地 → 官方 ApiProxy                                  │
│   │    session.list 合并去重（官方 + 远端 + 导入）              │
│   ├── ImportStore（外部会话导入，按软件手动开启）             │
│   │    只读解析 codex/claude/opencode/pi 日志 → 规范会话模型  │
│   │    文件监听 + mtime 增量扫描，缓存 dsh-session-hub-imports.json│
│   │    按 cwd 最长前缀归入工作区；无对应工作区的项目自动登记    │
│   │    首次发消息 → promote 成真实 DSH 会话（官方 create+replay）│
│   └── SessionHubRuntime (TypertRemoteService @Remote)          │
│        暴露 wire 命名空间 sessionHub（服务器管理/导入开关/同步）│
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
│  · 设置 → 插件 → 会话枢纽：服务器增删/状态/探活、按软件导入、  │
│    模型同步                                                    │
└────────────────────────────────────────────────────────────────┘
```

**实时通道**：每条远端链路的 mux/host WS 帧经 `HubEventBus` fan-out 到本地 SSE `/hub/events`；浏览器按 `event.seq` 与历史基线去重（打开会话先拉尾部历史，live 事件缓冲后按 `seq > tailSeq` 应用），`assistant/chunk` 增量折叠逐 token 气泡，审批/提问帧到达即上卡；SSE 断线自动重连。
导入会话的新增内容同样经该通道以 `session/event` 帧推给官方会话运行时，由文件监听驱动。