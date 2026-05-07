# Codex Remote Bridge

把 Discord 里的项目分区连接到本机 Codex CLI/tmux 会话。适合把 Windows、Linux、macOS 上的本地项目接入同一个 Discord Bot，在不同 thread 中绑定不同项目目录，然后持续接收 Codex 的执行进度和结果。

## 工作模型

- 一个 Discord Bot 可以服务多台真实电脑。
- 每台真实电脑运行一个 `cxb` Bridge 进程。
- 每台电脑配置一个独立的 Discord parent channel 或 Forum 作为机器入口。
- parent channel/Forum 下的子 thread 绑定本机项目目录。
- 每个项目不需要单独启动 Bridge 进程，Bridge 会按 thread 路由到对应 tmux/Codex 会话。
- Windows 使用 WSL 内的 `tmux` 和 `codex`；Linux/macOS 使用本机 `tmux` 和 `codex`。

## 安全边界

这个工具会让授权 Discord 用户把消息发送到本机 Codex CLI。请认真配置：

- `authorized_user_ids`：只放可信 Discord 用户 ID。
- `allowed_scopes`：每台机器只配置自己拥有的 parent channel/Forum。
- `allow_direct_injection`：默认建议保持 `false`，需要普通 Discord 文本直接进入 Codex 时再开启。
- `require_confirmation_for`：高风险操作保留确认，例如 `commit`、`push`、`delete`、`deploy`、`reset`。
- `.env.local`、`config/bridge.local.json`、`data/`、`logs/` 不要提交到 GitHub。

默认 tmux 会话以 Codex 的强权限模式启动，适合个人可信机器使用。不要把 Bridge 暴露给不可信频道或不可信用户。

## 准备工作

### Discord

在 Discord Developer Portal 创建 Application 和 Bot，并准备：

- Bot token
- Application ID
- Guild/Server ID
- 作为机器入口的 parent channel 或 Forum ID
- 授权用户的 Discord User ID

Bot 建议权限：

- View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Add Reactions
- Manage Threads
- Create Public Threads 或 Create Private Threads

如果要支持普通文本消息直接进入 Codex，还需要开启 Message Content Intent。

### 代理

浏览器能打开 Discord 不代表 Node.js 进程也会走同一个代理。`cxb status`、`cxb register`、`cxb up` 都会连接 Discord REST API；`cxb up` 还会连接 Discord Gateway WebSocket。如果机器访问 Discord 超时，可以在 setup 里填写 HTTP 代理，或手动写入 `.env.local`：

```text
CXB_PROXY=http://127.0.0.1:7890
```

运行时代理读取顺序：

```text
CXB_PROXY
DISCORD_PROXY
HTTPS_PROXY / https_proxy
ALL_PROXY / all_proxy
HTTP_PROXY / http_proxy
```

常见本地代理软件一般使用 `http://127.0.0.1:7890` 或 `http://127.0.0.1:7897`，请按实际端口填写。这里需要 HTTP/Mixed 代理端口，不是 SOCKS-only 端口。

### 本机

安装：

- Node.js 20+
- Codex CLI
- tmux

Windows 还需要：

- WSL
- WSL 内安装 `tmux`
- WSL 内可执行 `codex`

## 安装

```bash
npm install
npm run build
```

如果希望直接使用短命令：

```bash
npm link
```

之后可以使用：

```bash
cxb help
```

不使用 `npm link` 时，也可以用 npm scripts：

```bash
npm run setup
npm run up
npm run status
```

## 快速开始

1. 初始化配置：

```bash
cxb setup
```

向导会写入：

- `config/bridge.local.json`
- `.env.local`

2. 如果 setup 没有自动启动，手动启动：

```bash
cxb up
```

3. 在 Discord 的机器 parent channel/Forum 下创建或打开一个子 thread，绑定项目：

```text
/codex bind path:/absolute/project/path alias:my-project
```

Windows 路径示例：

```text
/codex bind path:E:\Projects\my-project alias:my-project
```

4. 点击 Confirm 按钮，或使用兜底命令：

```text
/codex confirm code:ABC123
```

5. 查看状态：

```text
/codex status
```

6. 发送任务：

```text
/codex send text:检查当前项目状态
```

如果配置开启了 `allow_direct_injection`，也可以直接在已绑定 thread 里发普通消息。

## 常用命令

```bash
cxb setup      # 初始化配置
cxb up         # 启动 Bridge
cxb down       # 停止 Bridge，并清理锁
cxb restart    # 重启 Bridge
cxb status     # 检查配置、Discord、tmux、Codex、绑定状态
cxb doctor     # status 的诊断别名
cxb register   # 重新注册 Discord slash commands
cxb hook       # 写入本机 hook 事件队列
```

兼容旧命令：

```bash
cxb start
cxb stop
cxb health
cxb register-commands
```

## 多机器配置

每台机器使用独立配置：

```text
machine_id: win-main / linux-prod / macbook
allowed_scopes: 每台机器自己的 Discord parent channel 或 Forum
data_dir: 本机 data 目录
log_dir: 本机 logs 目录
```

推荐结构：

```text
Discord Server
  #codex-win-main
    thread: project-a -> Windows 上的 E:\Projects\project-a
  #codex-linux-prod
    thread: service-api -> Linux 上的 /srv/service-api
  #codex-macbook
    thread: website -> macOS 上的 /Users/me/Projects/website
```

不要让两台机器配置同一个 `allowed_scopes`，否则同一个 Discord thread 可能被两个 Bridge 同时处理。

## 本地文件说明

这些文件只应该留在本机：

```text
.env.local
config/bridge.local.json
data/
logs/
dist/
node_modules/
```

`data/` 用于保存绑定关系、tmux session 信息、审批状态和本机事件队列。  
`logs/` 用于保存本机运行日志。  
这些文件可能包含项目路径、会话输出和操作记录，不要提交到 GitHub。

## 故障排查

### Bridge data directory is already locked

说明已有 Bridge 进程在运行，或上次异常退出留下锁。优先使用：

```bash
cxb down
cxb up
```

### Bot 在线但 slash command 不可用

重新注册命令：

```bash
cxb register
```

如果注册命令超时，先确认 `.env.local` 是否有 `CXB_PROXY`。浏览器正常但 `cxb register/status` 超时，通常就是 Node 进程没有走代理。

### Discord 没有持续反馈

检查 Bridge 是否是最新构建并已重启：

```bash
npm run build
cxb restart
```

### Windows 新项目卡在 trust prompt

新版 Bridge 会在新 tmux/Codex 会话启动时自动处理 Codex trust prompt。若旧会话仍卡住，先重启对应 Bridge 或解除绑定后重新绑定。

## 开发验证

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
```
