# Codex Channel Interactive Bot Bridge Plan

Last updated: 2026-05-04

## 目标

把 Discord 作为第一落地点，做一个可迁移、可扩展到 Telegram/飞书的 Codex CLI 交互桥：

- Codex CLI 在开始、执行、等待、停止、完成时主动把状态发到聊天平台。
- 用户可以在聊天平台里回复指令，让对应项目目录里的 Codex CLI 继续工作。
- 一个聊天上下文必须能稳定绑定到一个本机项目目录，避免把指令发错项目。
- 架构不要绑定死 Discord；Discord 只是第一个 provider，后续 Telegram、飞书通过 adapter 接入。
- 能迁移到其他机器/其他 Codex 安装：配置、绑定、会话状态分离，运行时能力可探测。

## 当前环境判断

本机已经具备基础条件：

- `~/.codex/config.toml` 已开启 `features.codex_hooks = true`。
- `~/.codex/hooks.json` 已配置 Codex native hooks：`SessionStart`、`PreToolUse`、`PostToolUse`、`UserPromptSubmit`、`Stop`。
- Codex CLI 已安装，支持交互式会话、`codex exec`、`codex resume` 等基础能力。
- 当前目标是先基于 `tmux` 打通双向交互，不依赖额外编排层。

关键限制：

- 单纯 Discord webhook 只能发消息，不能可靠收用户回复。交互版必须用 Discord Bot。
- 从聊天平台把用户回复注入 Codex CLI，最稳路径是让项目会话跑在 `tmux` 里。
- Linux 主机使用原生 `tmux`；Windows 主机优先使用 WSL + `tmux`。Windows 原生 ConPTY 可作为后续备选，不进入 MVP。

## 核心结论

推荐绑定模型：

1. **一个项目目录对应一个 `ProjectBinding`**。
2. **一个聊天上下文默认只绑定一个项目**。
3. Discord 上优先使用 **Forum Channel 或 Text Channel + Thread**：每个项目一个 thread。
4. 如果一个普通频道绑定多个项目，必须要求用户显式 `/use <project>` 或在每条命令里带 project alias；否则拒绝执行。
5. 跨平台统一使用 `conversation_key` 绑定项目，不把 Discord 的频道概念写死进核心逻辑。

推荐 Discord 组织方式：

- 最稳：一个 Discord server 里建一个 `codex-projects` forum channel，每个项目一个 forum post/thread。
- 次稳：一个 text channel 作为项目总入口，每个项目一个 public/private thread。
- 简单但不推荐长期使用：一个 text channel 绑定一个项目。
- 不建议：一个普通频道混跑多个项目且允许自然语言直接执行，容易路由错误。

## 术语

- **Provider**：聊天平台，如 Discord、Telegram、Feishu。
- **Conversation**：平台上的一个可对话容器。Discord 是 channel/thread；Telegram 是 chat/topic；飞书是 chat/message thread。
- **Project**：本机一个可执行 Codex CLI 的项目目录，如 `E:\Projects\iTradingAI`。
- **Binding**：conversation 到 project 的绑定记录。
- **Session**：某个 project 当前的 Codex CLI 运行会话，通常对应一个 tmux session/pane。
- **Bridge**：本地常驻服务，负责收平台消息、查绑定、控制 Codex CLI、回发状态。

## 总体架构

```text
Discord / Telegram / Feishu
        |
        v
Provider Adapter
        |
        v
Command Router
        |
        +--> Binding Registry
        +--> Auth / Policy Guard
        +--> Project Session Manager
        |
        v
Codex Runtime Adapter
        |
        +--> Codex CLI / tmux session
        +--> Codex native hooks
        +--> status/log readers
        |
        v
Provider Adapter sends status/replies back
```

分层要求：

- `providers/*` 只处理平台 API、消息收发、平台 ID 解析。
- `core/router` 只处理命令、绑定、授权、幂等和审计。
- `runtime/codex-tmux` 只处理启动、恢复、注入、状态采集、hook 事件。
- `storage` 只处理配置和状态持久化。

## 项目绑定设计

### Binding Key

统一绑定键：

```json
{
  "provider": "discord",
  "workspace_id": "guild:123",
  "conversation_id": "channel:456/thread:789",
  "scope": "thread"
}
```

Discord 映射：

- Server/Guild：`workspace_id = guild:<guild_id>`
- Text Channel：`conversation_id = channel:<channel_id>`
- Thread：`conversation_id = channel:<parent_channel_id>/thread:<thread_id>`
- Forum post：本质上按 thread 处理

Telegram 映射：

- Chat：`workspace_id = telegram`
- Group/Supergroup：`conversation_id = chat:<chat_id>`
- Forum Topic：`conversation_id = chat:<chat_id>/topic:<message_thread_id>`

飞书映射：

- Tenant/App：`workspace_id = tenant:<tenant_key>` 或 `app:<app_id>`
- Chat：`conversation_id = chat:<chat_id>`
- Message reply/thread：`conversation_id = chat:<chat_id>/thread:<root_message_id>`，如果平台事件能稳定提供 thread/root message 信息。

### Binding Record

建议结构：

```json
{
  "id": "proj_itradingai",
  "provider": "discord",
  "workspace_id": "guild:123",
  "conversation_id": "channel:456/thread:789",
  "project_path": "E:\\Projects\\iTradingAI",
  "project_name": "iTradingAI",
  "aliases": ["itrading", "ita"],
  "runtime": {
    "kind": "codex-tmux",
    "launch": "codex --cd E:\\Projects\\iTradingAI",
    "tmux_session": "codex-itradingai"
  },
  "policy": {
    "authorized_user_ids": ["discord_user_id_here"],
    "allow_direct_injection": true,
    "require_confirmation_for": ["commit", "push", "merge", "delete", "deploy"],
    "path_allowlist": ["E:\\Projects"]
  },
  "status": {
    "enabled": true,
    "last_seen_at": null,
    "last_session_id": null
  }
}
```

### 绑定命令

Discord MVP slash commands：

- `/codex bind path:<absolute_path> alias:<name>`
- `/codex unbind`
- `/codex status`
- `/codex start`
- `/codex resume`
- `/codex send text:<message>`
- `/codex projects`

自然语言回复规则：

- 在已绑定到单项目的 thread 里，普通消息默认注入该项目。
- 在未绑定频道里，普通消息不执行，只提示先 `/codex bind`。
- 在多项目频道里，普通消息不执行，必须 `/codex use` 或 `/codex send project:<alias>`。
- DM 默认不绑定项目，除非用户显式 `/codex use`，且该用户有权限。

### 绑定安全规则

绑定必须同时满足：

- `project_path` 是本机存在的目录。
- `project_path` 经过 canonical/realpath 归一化。
- `project_path` 在 allowlist 内，例如 `E:\Projects`、`E:\KEHU`。
- 目录不能是系统目录、用户 home 根目录、磁盘根目录。
- 首次绑定需要本机侧生成确认码，Discord 用户输入确认码后才写入绑定。

确认码流程：

```text
/codex bind path:E:\Projects\iTradingAI alias:ita
Bridge 在本机输出一次性 code
用户在 Discord 输入 /codex confirm code:123456
绑定生效
```

这样可以防止别人把频道恶意绑定到本机敏感目录。

## Discord 频道策略

### 方案 A：一个 Forum Channel，多项目多 thread

推荐。

结构：

```text
Discord Server
└── codex-projects (Forum Channel)
    ├── iTradingAI (Thread/Post) -> E:\Projects\iTradingAI
    ├── WPCN (Thread/Post) -> E:\KEHU\202603明辉
    └── Optly (Thread/Post) -> E:\KEHU\202512Optly
```

优点：

- 项目隔离清晰。
- 每个项目都有独立消息历史。
- 同一频道容器下可管理多个项目。
- 后续可以做 tags：`running`、`waiting-input`、`failed`、`done`。

缺点：

- Bot 需要正确处理 threads/forum events。
- 权限要包括读取 thread 消息、发 thread 消息、创建/管理 thread。

### 方案 B：一个 Text Channel，多项目多 thread

可行。

结构：

```text
#codex
├── thread: iTradingAI
├── thread: codex-channel
└── thread: optly
```

优点：

- 比 forum 简单。
- 适合先做 MVP。

缺点：

- 项目发现、归档、标签能力不如 forum。

### 方案 C：一个 Text Channel 绑定一个项目

适合极简使用。

结构：

```text
#codex-itradingai -> E:\Projects\iTradingAI
#codex-optly -> E:\KEHU\202512Optly
```

优点：

- 路由最简单。
- 出错概率低。

缺点：

- 项目多了以后频道膨胀。
- 不利于做跨平台统一抽象。

### 方案 D：一个频道混跑多个项目

不推荐作为默认。

如果必须支持，规则是：

- 频道只作为控制台。
- 每条执行命令必须指定 `project`。
- 普通自然语言不注入，除非已有用户级 active project，且 30 分钟内有效。

## “子频道绑定项目”怎么理解

Discord 没有传统意义上无限层级的子频道。可用的近似结构：

- Category：只是频道分组，不承载消息，不能作为交互会话绑定目标。
- Text Channel：可作为项目绑定目标。
- Thread：最适合当项目绑定目标。
- Forum Channel 的 Post：本质也是 thread，非常适合项目绑定。

因此设计上把“子频道绑定项目”落为：

- `Discord Forum Post/Thread -> Project`
- 或 `Discord Text Channel Thread -> Project`

## 运行时会话策略

每个项目维护一个可恢复会话：

```text
project_path -> runtime_session
runtime_session -> tmux session/pane -> codex process
```

### 运行时优先级

MVP 只做 `codex-tmux`：

- Linux 主机：Bridge 直接调用原生 `tmux` 管理 Codex CLI 会话。
- Windows 主机：Bridge 优先调用 WSL 内的 `tmux` 管理 Codex CLI 会话。
- Windows 原生 PTY/ConPTY：后续再评估，MVP 不实现。
- `codex exec`：可作为一次性任务 fallback，但不承担长会话交互。

运行时适配器必须把平台差异收敛到同一组操作：`detect`、`start`、`send`、`readRecent`、`status`、`stop`。核心 router 不关心会话运行在 Linux 原生 tmux 还是 WSL tmux。

状态机：

```text
unbound
  -> bound
  -> starting
  -> running
  -> waiting_input
  -> paused
  -> completed
  -> failed
  -> stale
```

### 启动

`/codex start`：

1. 根据 conversation 查 project binding。
2. 检查 project path。
3. 检查是否已有活跃 tmux session。
4. 没有则启动：

Linux:

```bash
tmux new-session -d -s codex-itradingai -c /path/to/project 'codex'
```

Windows:

```powershell
wsl.exe tmux new-session -d -s codex-itradingai -c /mnt/e/Projects/iTradingAI 'codex'
```

或项目配置里的启动命令。

5. 记录 `tmux_session`、`pane_id`、`session_id`。
6. 回 Discord：已启动、目录、分支、状态。

### 注入回复

普通消息注入前检查：

- conversation 已绑定唯一 project。
- sender 在 authorized users 内。
- runtime session 处于可接收输入状态。
- 输入长度不超过限制。
- 内容经过控制字符清理。
- 高风险关键词触发确认策略。

注入方式：

```text
Provider message
  -> sanitize
  -> policy check
  -> tmux send-keys literal text
  -> isolated Enter
  -> ack back to provider
```

### Hook 回传

Codex native hook 事件进入 Bridge：

- `session-start`：项目开始/恢复
- `pre-tool-use`：准备执行工具，默认聚合而不是逐条发
- `post-tool-use`：工具结果摘要
- `stop` / `session-stop`：停止、被拦截、需要继续或确认
- `session-idle`：长时间无输入或无输出
- `session-end`：完成
- `needs-input` / `ask-user-question`：需要用户决策
- `failed`：失败

Bot 不应逐条转发所有 hook。默认策略：

- `minimal`：start、needs-input、stop、end、failed
- `session`：加 idle 和阶段摘要
- `verbose`：加工具摘要，但做 30-60 秒聚合

## 命令设计

### 必须命令

```text
/codex bind path alias
/codex confirm code
/codex unbind
/codex status
/codex start
/codex resume
/codex pause
/codex send text
/codex projects
```

### 建议命令

```text
/codex logs lines
/codex branch
/codex cwd
/codex allow-user user
/codex deny-user user
/codex policy
/codex pause
/codex use alias
/codex migrate export
/codex migrate import
```

### 高风险动作

以下动作默认需要显式确认：

- `git push`
- `git merge`
- `git reset`
- 删除目录/批量删除
- 部署/发布
- 修改全局配置
- 写入 secrets/token

确认方式：

```text
Bot: 检测到高风险动作，回复 approve 8K2P 继续，或 reject 8K2P 取消。
User: approve 8K2P
Bridge: 只把原始指令释放给 Codex，确认码一次性失效。
```

## 多平台抽象

### Provider Adapter Interface

```ts
interface ProviderAdapter {
  name: "discord" | "telegram" | "feishu";
  start(): Promise<void>;
  sendMessage(target: ConversationRef, message: OutboundMessage): Promise<ProviderMessageRef>;
  editMessage?(message: ProviderMessageRef, message: OutboundMessage): Promise<void>;
  react?(message: ProviderMessageRef, reaction: string): Promise<void>;
  onMessage(handler: (event: InboundMessage) => Promise<void>): void;
  onCommand(handler: (event: InboundCommand) => Promise<void>): void;
}
```

### 统一消息结构

```ts
interface InboundMessage {
  provider: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  parentMessageId?: string;
  senderId: string;
  senderName?: string;
  text: string;
  isCommand: boolean;
  raw: unknown;
}
```

### 统一输出结构

```ts
interface OutboundMessage {
  kind: "status" | "question" | "error" | "summary" | "approval";
  title?: string;
  text: string;
  fields?: Array<{ label: string; value: string }>;
  actions?: Array<{ id: string; label: string; style?: "primary" | "danger" }>;
}
```

### 平台能力矩阵

| 能力 | Discord | Telegram | 飞书 |
| --- | --- | --- | --- |
| Bot 收消息 | 支持 | 支持 | 支持 |
| Slash/命令 | 支持 slash commands | 支持 bot commands | 支持菜单/消息事件 |
| Thread/Topic | 支持 thread/forum | 支持 forum topic `message_thread_id` | 取决于 chat/reply/thread 事件 |
| 富消息/按钮 | 支持 components/interactions | 支持 inline keyboard | 支持互动卡片 |
| Webhook-only 交互 | 不够 | 可接收 webhook updates | 可事件订阅/WebSocket |
| 推荐绑定粒度 | thread/post | chat topic | chat/thread 或 bot 单聊 |

## 可迁移设计

### 配置文件

项目建议：

```text
E:\Projects\codex-channel
├── docs
├── config
│   ├── bridge.example.json
│   └── providers.example.json
├── data
│   ├── bindings.json
│   ├── sessions.json
│   └── audit.jsonl
└── src
```

实际 secrets 不入库：

```text
%APPDATA%\codex-channel\secrets.json
```

或：

```text
C:\Users\Max\.codex\codex-channel-secrets.json
```

### 迁移包

`/codex migrate export` 生成：

```json
{
  "version": 1,
  "bindings": [],
  "policies": [],
  "provider_public_config": [],
  "machine_requirements": {
    "codex": true,
    "tmux": true,
    "wsl_tmux": false
  }
}
```

不导出：

- Bot token
- Discord application secret
- Feishu app secret
- Telegram bot token
- 本机绝对路径的自动信任状态

导入到另一台机器时：

1. 检测 Codex CLI、tmux、WSL/tmux。
2. 映射旧路径到新路径。
3. 重新验证项目目录。
4. 重新输入平台 secrets。
5. 重新跑 smoke test。

## 安全边界

最低安全要求：

- 用户白名单：每个 binding 都有 authorized user IDs。
- 路径白名单：只允许绑定到配置允许的项目根目录下。
- 高风险命令二次确认。
- 所有注入输入都清理控制字符和超长内容。
- 审计日志记录：谁、在哪个 conversation、向哪个 project、发送了什么摘要、是否执行。
- Bot token 只保存在本机 secrets 文件或系统凭据管理器，不进 repo。
- Bridge 默认只监听绑定 conversation；未绑定消息不进入 Codex。
- “status” 是只读命令，可开放得更宽；“send/resume/start” 必须严格授权。

## MVP 分期

### Phase 1：Discord Bot + 单项目绑定

目标：

- 创建 Discord Bot。
- 支持 `/codex bind`、`/codex confirm`、`/codex status`。
- 一个 channel/thread 绑定一个 project。
- 能启动/识别 tmux 中的 Codex CLI 会话。
- 能把 `status` 回发到 Discord。

验收：

- 未绑定频道拒绝执行。
- 绑定到不存在路径失败。
- 绑定到 allowlist 外路径失败。
- 授权用户能查看状态。
- 非授权用户不能注入指令。
- Linux 主机能检测原生 `tmux` 和 `codex`。
- Windows 主机能检测 WSL 内的 `tmux` 和 `codex`。

### Phase 2：双向交互

目标：

- 支持 `/codex start`、`/codex resume`、`/codex send`。
- 普通消息在绑定 thread 内可注入 Codex。
- Bot 能回传 ack 和最近输出摘要。
- Codex stop/needs-input 能发回 Discord。

验收：

- Discord 回复能进入对应项目 tmux pane。
- 同一套 router 能分别驱动 Linux 原生 tmux 和 Windows WSL tmux。
- 同 server 两个不同 thread 分别绑定不同项目，不串线。
- 同频道多项目时，未指定项目的自然语言被拒绝。

### Phase 3：项目频道模型完善

目标：

- 支持 Discord forum channel：每个项目一个 post/thread。
- 支持自动创建项目 thread。
- 支持 `/codex projects` 展示所有绑定。
- 支持 `/codex use` 临时选择项目。

验收：

- 一个 forum channel 下多个项目并行可用。
- thread 归档后发送消息可恢复或提示用户重开。
- 每个项目状态独立。

### Phase 4：跨平台 adapter

目标：

- Telegram provider：chat/topic 绑定 project。
- 飞书 provider：chat/thread 绑定 project。
- provider adapter 使用同一 core router。

验收：

- Discord、Telegram、飞书任意一个 provider 的入站消息都能转成统一 `InboundMessage`。
- 同一项目可绑定多个平台 conversation。
- 同一 conversation 不允许隐式绑定多个 project。

### Phase 5：迁移与守护进程

目标：

- Windows service 或 scheduled task 自启动 Bridge。
- 支持 export/import bindings。
- 支持 health check 页面或 CLI。
- 支持异常恢复：Bridge 重启后重新发现 tmux sessions。

验收：

- 重启 Bridge 后原有绑定仍在。
- 重启电脑后服务恢复。
- bot token 不在迁移包里。

## 建议技术栈

MVP 建议用 Node.js/TypeScript：

- Discord：`discord.js`
- Telegram：先 adapter 预留，后续可用 Bot API HTTP 或成熟 SDK
- 飞书：后续用官方/社区 Lark SDK 或直接 HTTP + event subscription
- 本机控制：Node `child_process` 调用 `tmux`、`codex`；Windows 通过 `wsl.exe tmux` 进入 WSL 会话
- 存储：先 JSON 文件，后续可换 SQLite
- 日志：JSONL

不要一开始引入数据库和复杂队列。先把路由、绑定、权限、tmux 注入和跨主机 runtime detect 跑通。

## 文件与状态建议

```text
data/bindings.json
data/sessions.json
data/audit.jsonl
data/pending-approvals.json
logs/bridge.jsonl
logs/provider-discord.jsonl
```

`bindings.json` 是长期配置。

`sessions.json` 是运行态，可重建。

`audit.jsonl` 记录用户输入和执行摘要，长期保留。

## 开发任务拆分

1. 初始化项目结构和 TypeScript 工程。
2. 实现 `BindingRegistry`。
3. 实现 `ProjectPathGuard`。
4. 实现 `DiscordProviderAdapter`。
5. 实现 slash commands：bind/confirm/status。
6. 实现 `CodexTmuxRuntimeAdapter`：detect/start/status。
7. 实现 Linux 原生 tmux 注入：send/resume/readRecent。
8. 实现 Windows WSL tmux 注入：路径转换、send/resume/readRecent。
9. 实现 hook ingress：接收 Codex native lifecycle events。
10. 实现安全策略：授权用户、高风险确认、审计日志。
11. 写 smoke tests：两个 thread 绑定两个 fake project，不串线；Windows/WSL 与 Linux 各跑一次 runtime detect。
12. 写部署文档：Discord Bot 创建、权限、env/secrets、本机启动。

## Discord Bot 权限建议

最小权限：

- Read Messages/View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Send Messages in Threads
- Create Public Threads 或 Create Private Threads
- Manage Threads：仅当需要自动恢复/管理 thread 时开启

Gateway intents：

- Guilds
- Guild Messages
- Message Content：如果要让普通自然语言回复直接注入，需要开启；如果只用 slash commands 和 buttons，可尽量不用。

## 待用户提供的信息

开发交互版前需要：

- Discord Bot Token
- Discord Application ID
- Discord Guild ID
- 目标 channel/forum ID
- 授权用户 Discord ID
- 项目路径 allowlist，例如 `E:\Projects`
- 是否允许普通消息直接注入，还是必须 `/codex send`

## 推荐默认决策

- 使用 Discord Forum Channel，每个项目一个 post/thread。
- Binding 粒度默认是 thread，不是整个 server。
- 普通频道只能绑定一个项目；多项目必须 thread 化。
- 先只开放 `/codex send` 注入，普通消息注入作为可选开关。
- 高风险动作默认二次确认。
- Bridge 做成本地常驻服务，不改 Codex CLI 核心，减少升级冲突。
- 所有 provider 都走统一 router，避免 Discord 方案变成不可迁移的单点实现。

## 参考

- Discord Bots: https://docs.discord.com/developers/platform/bots
- Discord Interactions: https://docs.discord.com/developers/platform/interactions
- Discord Threads: https://docs.discord.com/developers/topics/threads
- Telegram Bot API: https://core.telegram.org/bots/api
- 飞书接收消息事件 `im.message.receive_v1`: https://feishu.apifox.cn/doc-1945610
- 飞书发送消息 API: https://feishu.apifox.cn/api-58348294
