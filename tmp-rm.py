import io
p='README.md'; s=io.open(p,encoding='utf-8').read()

old_start = s.index('**② 本机** —— 装插件、建隧道：')
old_end = s.index('**③ 浏览器**')
old = s[old_start:old_end]
new = """**② 本机** —— 只装插件：

```bash
dsh plugin --profile web add https://github.com/Asaiuta/dsh-session-hub/archive/refs/tags/v0.1.0-alpha.1.tar.gz
# 重启 dsh web
```

隧道不用自己建 —— 下一步填好 SSH 信息，插件会自己开、自己保活。

"""
s = s.replace(old, new)

old3 = s[s.index('**③ 浏览器** `http://127.0.0.1:3080`：'):s.index('<!-- 截图占位')]
new3 = """**③ 浏览器** `http://127.0.0.1:3080`：

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

"""
s = s.replace(old3, new3)

old_note = s[s.index('> **隧道是目前唯一的连接方式。**'):s.index('### 导入本机其他工具的会话')]
new_note = """> **为什么一定要隧道**：当前 dsh（0.1.0-rc.6）拒绝把 Web 服务绑到环回以外 —— `--host 0.0.0.0` 被 CLI 挡下
> （*"would expose remote code execution to the network"*），具体 LAN IP 连配置校验都过不了（`host` 只接受
> `127.0.0.1` 与 `0.0.0.0` 两个字面量）。所以远端保持默认，由隧道把它带到本机环回；这也意味着**不存在把 3080
> 暴露公网的选项**，上游已经先一步堵死了。
>
> 隧道进程活在 dsh 里：dsh 退出时一并关闭，dsh 启动时按保存的配置自动重建（端口每次重新分配，所以配置里存的是
> SSH 目标而不是 URL）。SSH 掉线会以退避重连，恢复后链接自动指向新端口。

"""
s = s.replace(old_note, new_note)
io.open(p,'w',encoding='utf-8').write(s)
print('README ok')
