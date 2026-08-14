# 更新日志

本文件记录每个发布版本的实际变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> Alpha 阶段：`0.1.0-alpha.*` 之间允许破坏性变更，破坏点会在下方逐条写明。

## [0.1.0-alpha.2] - 2026-08-14

这一版把「用户得自己开隧道」这件事收进插件，并让四个功能可以分开安装。
另有三个 bug 修复，其中一个会让 `dsh` 完全无法启动。

### 新增

- **SSH 隧道托管** —— 添加服务器时填 `user@host` 与私钥路径，插件自己开隧道、自己保活重连，
  本地端口由它分配，用户不必再手动跑 `ssh -L`，也不必知道端口号。
  隧道跟随 `dsh` 进程生命周期：`dsh` 退出即关闭，启动时按保存的 SSH 目标自动重建。
  掉线按指数退避重连，恢复后链接自动指向新端口。
  ([#46dccc8](https://github.com/Asaiuta/dsh-session-hub/commit/46dccc8))

- **四个功能开关**（`features.aggregate` / `tunnel` / `modelSync` / `importer`），默认全开。
  关闭 = 不构造服务、不读缓存、不扫目录、不注册路由、不在设置页出现；四个全关时插件不拦截任何 `/api`。
  单机用户可只开导入，多机用户可关掉导入。
  ([#819cb07](https://github.com/Asaiuta/dsh-session-hub/commit/819cb07))

- 添加服务器表单支持 **SSH / 直连** 双模式，服务器卡片显示隧道状态（可区分「隧道没起来」与「远端挂了」）。

### 修复

- **路由撞车会导致整个 `dsh` 起不来。** 本插件为实现会话合并接管了 17 条 exact 路由；
  另一个插件若也占用其中一条，DSH 的 web server 会抛错，而这个异常会失败整个 loader entry
  和插件树 —— 用户直接没有 dsh 可用。且注册循环中途抛错时，已占的路由无人回收，留下一个
  「半装的网关」（部分会话方法应答、部分不应答），比没装更糟。
  现在两处路由注册都会归还已占路径并降级：宿主与对方插件照常运行，只有依赖网关的功能安静下来，
  日志说明是哪条路由与如何绕开。
  ([#6842a36](https://github.com/Asaiuta/dsh-session-hub/commit/6842a36))

- **已应答的审批不会从 pending 表移除。** `approval/resolved` 帧带的是**另一个** `rpcId`，
  与 `approval/requested` 的信封 id 不同，所以旧代码按信封 id 删除永远删不掉：
  每个已处理的审批都会在 hub 的 pending 表里留到进程结束，再去应答会得到 `not-pending`。
  现在按 `approvalId` 清理审批、按 `questionRpcId` 清理提问 —— 这两种 resolved 帧不共用一个键。
  ([#4f83c0f](https://github.com/Asaiuta/dsh-session-hub/commit/4f83c0f))

- **设置页输入框在浅色主题下全黑。** 样式里用了 6 个官方并不存在的 CSS 变量
  （`--dsw-alias-input-fill`、`--dsw-accent-ui` 等），`var()` 静默回退到硬编码的深色字面量。
  现在改用官方实际提供的令牌（输入框透明 + 容器 `--dsw-alias-bg-layer-1`，主按钮
  `--dsw-alias-button-primary-fill`），并逐个核对令牌确实存在于官方样式表。
  ([#36f27ad](https://github.com/Asaiuta/dsh-session-hub/commit/36f27ad))

- **远端会话跑完了，UI 还在永远转圈。** 官方客户端对两类帧走不同入口：`host/*` 帧同时送给
  `sessions.handleHostEnvelope` 与 `workspaces.handleHostEnvelope`，mux 帧才走 `handleMuxEnvelope`。
  旧桥只把 `host/workspace-*` 当 host 帧，**其余全部塞进 mux 入口** —— 而 mux 的 switch 不认识
  它们，于是静静丢弃。受害者是 `host/session-status`：它正是调用 `handleRunning()`、驱动会话
  “运行中”指示的那一帧。后果：在 UI 开着的期间结束的远端会话，转圈永不停（刷新页面才正常）。
  现在按官方语义分流：所有 `host/*` 同时喂两个 runtime，其余走 mux。
  ([#0273370](https://github.com/Asaiuta/dsh-session-hub/commit/0273370))

### 变更

- **破坏性：Typert wire 面从 18 个方法收缩到 7 个。** 移除
  `serversList`、`serversUpdate`、`sessionHistory`、`sessionPrompt`、`sessionCancel`、
  `sessionRename`、`sessionFork`、`sessionCreate`、`sessionModels`、`sessionSelectModel`、`respond`
  —— 这些是早期「自绘对话区」方案的残留，实际会话操作早已全部走网关的 `/api` 路由。
  保留 `snapshot`、`serversProbe`、`serversAdd`、`serversRemove`、`modelSync`、`importStatus`、`importAction`。
  已移除的端点现在返回 404。**影响范围**：仅限直接调用 `/api/sessionHub/*` 的外部脚本；
  正常使用（浏览器 UI）不受影响。
  ([#80d0995](https://github.com/Asaiuta/dsh-session-hub/commit/80d0995))

- 注册表新增 `ssh` 字段用于隧道条目（`version` 仍为 `1`，`baseUrl` 直连条目照常读取）。

### 文档

- README 重构：导入功能不再被写成「顺手」的附属品 —— 两个能力平级呈现，
  快速开始按「只要导入 / 要接远端」分叉，环境要求区分两者各自的前置条件。
  ([#38dee7d](https://github.com/Asaiuta/dsh-session-hub/commit/38dee7d))
- 新增「和其他插件共存」章节：说明本插件只往 `settings.plugins.tab` 加一个条目、不 shadow 任何单槽，
  换侧边栏/对话区的 UI 插件可与之并存（且会自动显示远端与导入的会话）；
  唯一真冲突是同样拦截 `/api` 的插件。
- 修正快速开始里一段**并不存在**的说法：此前称「不用隧道也行，CLI 会自动放行局域网 IP」。
  实测 dsh 0.1.0-rc.6 直接拒绝 `--host 0.0.0.0`，具体 LAN IP 连配置校验都过不了 ——
  隧道是目前唯一的连接方式。
  ([#36d8777](https://github.com/Asaiuta/dsh-session-hub/commit/36d8777))

### 升级说明

直接重装并重启 `dsh web` 即可，注册表与导入缓存都向后兼容，无需迁移：

```bash
dsh plugin --profile web add dsh-session-hub@alpha
```

**关于降级**：若用本版建过 SSH 隧道条目，再降回 `0.1.0-alpha.1`，那些条目会被旧版跳过
（旧版要求条目必须有 `baseUrl`）—— 不会崩溃、不会丢文件，升级回来即恢复。直连条目不受影响。

## [0.1.0-alpha.1] - 2026-08-14

首个发布版本。

### 新增

- **多服务器会话聚合**：宿主侧 `HubGateway` 以 exact 路由接管官方 `/api` 会话方法，
  按会话归属路由（远端 → `ServerLink`，本地 → 官方 `ApiProxy`），`session.list` 合并去重；
  浏览器侧把远端 mux 帧注入官方 `sessions.handleMuxEnvelope`，**官方 UI 零替换**地渲染远端会话。
- **虚拟工作区分组**：每台服务器成为工作区树里的一个分组，支持原生树操作
  （新建会话 / 归档 / 重命名分组 = 重命名服务器 / 删除分组 = 断开连接）。
- **实时通道**：远端 mux/host WS 帧经 `HubEventBus` fan-out 到本地 SSE `/hub/events`
  （随机 token + 环回 Host + same-origin 三重围栏），浏览器按 `seq` 去重后逐 token 渲染。
- **外部会话导入**：读取本机 Codex CLI / Claude Code / opencode 的历史日志，
  按项目目录归入对应工作区，**按软件逐个手动开启**；导入会话只读，
  首次发消息自动转成真实 DSH 会话；源日志只读打开，从不改写。
- **模型配置增量同步**：把本机有而远端缺的提供方、默认模型与 API Key 补到已连服务器，只补缺不覆盖。
- **自环检测**：拒绝把 hub 指向自己（通过本进程 `/hub/events` token + `text/event-stream` 双重判定）。

[0.1.0-alpha.2]: https://github.com/Asaiuta/dsh-session-hub/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/Asaiuta/dsh-session-hub/releases/tag/v0.1.0-alpha.1
