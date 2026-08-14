# dsh-session-hub

> ⚠️ **Alpha** — `0.1.0-alpha.1`：协议与 API 仍在演进。核心链路（网关路由 / 官方 UI 桥接 / 实时帧注入 / 审批应答）已实机验证，但配置格式与安全边界可能变化。

## Overview

**在单个 DSH Web UI 里聚合并原生操控多台 DeepSeek Harness 服务器的会话。**

这个插件把若干台远端 `dsh web` 部署的会话聚合进你本机的官方界面：

- **官方侧边栏树零改动**：每台服务器自动成为官方工作区树中的一个分组（虚拟 workspace，`workspace.list` 合并 + 合成 `host/workspace-changed` 帧实时同步），会话点击即打开；树内操作全为原生语义：虚拟组 **+ 新建会话** 在对应服务器上创建、会话菜单 **归档/删除** 路由到所在服务器、**重命名** 虚拟组 = 重命名服务器、**删除** 虚拟组 = 移除该服务器连接（均带官方确认弹窗）；
- **官方对话区零替换**：远端的会话历史、实时逐 token 流、审批/提问卡片全部由官方组件渲染，插件只做数据桥接；
- **设置 → 插件 → Session Hub**：服务器连接管理（增删/状态/探活、远端新建会话、模型配置同步）。侧边栏零改动；
- **外部会话导入（按软件手动开启）**：把本机 Codex CLI / Claude Code / opencode 的历史对话读进官方目录树，按项目目录自动归入对应工作区。默认不读取任何日志——在 设置 → 插件 → Session Hub 里逐个软件点「导入」才生效，可单独开关「自动」跟进新会话。导入会话为只读，点击继续对话时自动转为真实 DSH 会话；
- **模型配置增量同步**：服务器连上后自动把本机缺失于远端的模型提供方（`llm-*` 命名空间）、默认模型与未配置的 API Key 增量推送到远端——只补缺、不覆盖远端已有配置，密钥走 `credentials.set` 单一出站方向。

全部通过 DSH 自有的 `/api` 协议原生完成——不依赖 SSH、不做屏幕抓取、不改远端任何配置、不在远端装任何插件。

**适合谁**：有多台 DSH 服务器（家里的、公司的、云上的）且希望在一个界面里统管的人；不想要桌面壳/手机端/多开浏览器的人。

## Compatibility

| 项 | 说明 |
|---|---|
| 宿主 DSH | 实测 `@deepseek-ai/dsh@0.1.0-rc.6`（npm 发行版）✅ |
| 主仓库 mainline | 未逐 commit 跟踪；接口演进期请以发行版为准 |
| Node | `^22.19 \|\| >=24`（`engines`；依赖内置 `WebSocket`/`fetch`） |
| 远端 DSH | 任何能应答标准 `/api` 的 `dsh web`（含 0.1.0-rc.x 实测） |
| 浏览器 | 官方 Web UI（无版本约束，插件零替换 UI） |
| **最后验证** | **2026-08-14**：本地 Windows + Node v24.9.0 ↔ 远端 Linux(OpenCloudOS 9.4) + Node v24.9.0，SSH 隧道跨机对话/审批/实时流全链路通过 |

> ⚠️ Alpha 兼容性承诺：配置格式、路由表、`/hub/events` 帧协议在 1.0 前可能破坏性变更。

## Install / Uninstall

### 安装（npm 分发）

```bash
dsh plugin --profile web add dsh-session-hub
```

（等价于在 `~/.dsh/profiles/web` 目录执行 `pnpm add dsh-session-hub`；本机需要 pnpm。）随后**重启 `dsh web`**。浏览器界面 **设置 → 插件** 中多出 **Session Hub** 标签页即安装成功。

### 安装（本地源码 / 开发）

```bash
git clone https://github.com/Asaiuta/dsh-session-hub
dsh plugin --profile web add file:/path/to/dsh-session-hub
# 或手动挂载 bundle：把 cordis.patch.yml 的 insert 条目并入 profile 的 patch 层
```

### 升级

```bash
dsh plugin --profile web add dsh-session-hub@<新版本>   # 或重跑 add file:...（源码方式重新构建）
# 重启 dsh web 生效
```

### 禁用（临时）

从 profile 的 bundle 列表 / `cordis.patch.yml` patch 层移除 `dsh-session-hub` 条目后重启。服务器注册表文件**保留**，重新启用即恢复。

### 彻底移除

1. 按上面移除 bundle/patch 条目并重启；
2. 删除注册表：`$DSH_HOME/plugins/dsh-session-hub.json`（默认路径，见 Configuration）。

## Quick start

**最小可复现示例：一台远端 + 本机 hub + SSH 隧道**

```bash
# ── 远端（10.0.0.5）──
# 保持默认环回监听最安全（配合隧道）；也可 --host 0.0.0.0 直连局域网
dsh web --port 3080

# ── 本机 ──
dsh web                                  # 默认 http://127.0.0.1:3080
dsh plugin --profile web add dsh-session-hub
# 重启 dsh web 后，建立隧道：
ssh -N -L 127.0.0.1:3333:127.0.0.1:3080 user@10.0.0.5

# ── 浏览器 http://127.0.0.1:3080 ──
# 1. 设置 → 插件 → Session Hub → 「添加服务器」→ 名称: tencent, baseUrl: http://127.0.0.1:3333
#    点「测试」（返回远端 DSH 版本即通）→ 添加
# 2. 官方工作区树出现该服务器的分组（名为服务器名，会话在组内；本地组并列）
# 3. 点击会话：官方对话区打开——历史加载、实时逐 token 流、审批/提问卡片、发送/取消/重命名
```

### 导入本机其他工具的会话（可选）

设置 → 插件 → Session Hub → **外部会话**，按软件点「导入」：

| 软件 | 读取位置 |
|---|---|
| Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| opencode | `~/.local/share/opencode/opencode.db` |

未点「导入」的软件其日志完全不会被读取。导入后勾选「自动」可每 60 秒增量跟进新产生的会话，取消勾选则只在你手动点刷新时更新。「移除」把该软件的会话撤出目录树，不影响其他软件，也不动原始日志。

导入的会话在树中只读；直接向它发消息会自动转成真实 DSH 会话（保留用户/助手对话，原只读副本隐藏）。

直连局域网替代隧道：远端 `dsh web --host 0.0.0.0`（CLI 自动推导 LAN IP 白名单），本地添加 `http://10.0.0.5:3080`。**不要把 3080 暴露到公网**（信任围栏不是认证）。

## Configuration

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

**环境变量**：
- `DSH_HOME`：影响注册表默认路径（默认 `~/.dsh`）；
- 无需任何 API key / 令牌环境变量。

**敏感项**：无持久化密钥。运行期 `/hub/events` 的随机 token 每进程生成一次，仅经快照下发到浏览器，不落盘。

## Permissions & data

**文件访问**：
- 读/写 `$DSH_HOME/plugins/dsh-session-hub.json`（`0600`，原子写：tmp + rename）；
- 读/写 `$DSH_HOME/plugins/dsh-session-hub-imports.json`（导入会话解析缓存，`0600`）；
- 只读扫描本机会话日志：`~/.codex/sessions/**/rollout-*.jsonl`、`~/.claude/projects/**/*.jsonl`、`~/.local/share/opencode/opencode.db`（SQLite 只读打开），用于生成**只读**的导入会话视图；绝不写回这些文件。**按软件逐个手动导入**：未在设置里点「导入」的软件，其日志不会被读取。

**网络**：
- 出站（对每个已配置服务器 `baseUrl`）：HTTP `POST /api/*`（unary RPC）+ WebSocket 升级 `/api/events.mux`、`/api/events.host`；
- 入站（本机进程内）：`/hub/events` SSE（仅环回 Host + 随机 token + 浏览器 same-origin 三重校验）、Typert `/api/sessionHub/*`（环回）；
- 入站（浏览器）：被拦截的 `/api/session.*` 与 `/api/respond` 会经网关再校验环回/`trustedHosts`。

**凭据**：模型同步功能会读取本机 `$DSH_HOME/.credentials.yaml` 明文（仅用于提取 `llm-*` 命名空间 `apiKeyEnv` 引用的密钥值），并在**远端未配置**该引用时经 `credentials.set` 写入远端（唯一的密钥出站方向，隧道/HTTPS 下加密）。密钥从不随响应回传，hub 也不落盘密钥副本。若不想自动推送密钥，可在服务器配置中不启用模型同步（或拆掉该服务器的 `llm-*` 命名空间）。

**用户数据**：远端会话列表、历史内容、实时流会经由 hub 进程与浏览器中转显示——跨机传输建议走 SSH 隧道（加密）；我方不明文落盘任何会话内容。

## Troubleshooting

| 症状 | 原因 / 处理 |
|---|---|
| 添加服务器报 `self-loop` | baseUrl 指向 hub 自身。插件启动时也会自动检测并跳过自环条目（日志 warn） |
| 历史加载失败 `signal timed out` | 最常见：SSH 隧道断了。检查 `netstat -ano 竖 grep :3333`；重启隧道后远端自动重连 |
| 历史加载失败 `invalid_value … expected "server-response"` | 旧版本网关直通缺陷，**升级到 0.1.0-alpha.1+**（已修复：出口统一补 `type: 'server-response'`） |
| 会话列表少了一项 | 冷启动后远端首个 `session.list` 拉取未完成；打开会话本身会触发重拉 |
| 实时流断开（LIVE 徽标变灰） | SSE 自动重连；发送后 900ms 无实时事件自动回退历史重载 |
| 插件未生效 | 检查 `dsh plugin` 后是否重启 web；看启动日志有无 `dsh-session-hub` 加载与 gateway 使能信息 |

**日志位置**：`dsh web` 进程 stdout/stderr——systemd 部署 `journalctl -u dsh-web`，nohup 部署看输出文件；本地终端部署看控制台。

**回滚**：npm 方式降级 `dsh plugin … add dsh-session-hub@<上一版本>`；源码方式 `git checkout <上一 commit>` 后重建重启。注册表文件向后兼容（未知字段忽略）。

## Development

```bash
git clone https://github.com/Asaiuta/dsh-session-hub && cd dsh-session-hub
npm install          # devDeps：esbuild / typescript / zod / react
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm run build        # esbuild → lib/index.js + lib/client.js + lib/types/
```

- 类型检查走仓库自带 `stubs/`（按 harness 源码抄写的最小声明面，经 tsconfig `paths` 映射）；对真实 DSH checkout 构建可删 `paths`/`stubs`、把 `@deepseek-ai/*` 引回 `link:` devDeps（参考 dsh-interconnect）。
- `@deepseek-ai/dsh-*` 未发布到 npm，运行时由 profile 提供（peerDeps 因此全部 optional）。
- **测试**：当前无自动化套件；冒烟路径（网关合并去重、SSE 三重鉴权、跨机实时对话、审批应答、self-loop 拒绝）为实机手动验证。欢迎贡献测试与 PR。

## License & security

- License：**[MIT](./LICENSE)**。
- 安全边界：见上方 Permissions & data；设计不变量——不中继特权域、审批一律人工应答（插件不做自动放行）、自环/未授权源一律拒绝。
- **私密报告**：请通过 [GitHub Issues](https://github.com/Asaiuta/dsh-session-hub/issues) 提交（标注 `[security]`），或直接联系维护者 [@Asaiuta](https://github.com/Asaiuta)；修复前不会公开细节。

---

## 架构（补充）

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