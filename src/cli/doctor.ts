import { createBridge } from "../app.js";
import { DiscordProviderAdapter } from "../providers/discord/discord-provider.js";
import { buildDaemonCommands } from "./daemon.js";
import { looksLikeDiscordToken } from "./env.js";
import { maskProxyUrl, selectProxyEnv } from "./proxy.js";
import { ExecFileCommandRunner, type CommandRunner } from "../runtime/process.js";
import type { RuntimeCapability, SessionState } from "../types.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorSession {
  project: string;
  tmuxSession: string;
  state: SessionState;
}

export interface DoctorReport {
  ok: boolean;
  configPath: string;
  machineId?: string;
  checks: DoctorCheck[];
  suggestions: string[];
  nextCommands: string[];
  sessions: DoctorSession[];
}

export interface DoctorOptions {
  runner?: CommandRunner;
}

export async function runDoctor(configPath: string, options: DoctorOptions = {}): Promise<void> {
  const report = await collectDoctorReport(configPath, options);
  console.log(formatDoctorReport(report));
}

export async function collectDoctorReport(
  configPath: string,
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const suggestions: string[] = [];
  const nextCommands = [
    `crb logs --config ${configPath} --errors`,
    `crb daemon --config ${configPath}`,
    `crb register --config ${configPath}`,
    `crb update --config ${configPath}`
  ];
  const runner = options.runner ?? new ExecFileCommandRunner();
  let sessions: DoctorSession[] = [];
  let daemonRunning = false;
  let discordConnected = false;

  let bridge: Awaited<ReturnType<typeof createBridge>>;
  try {
    bridge = await createBridge(configPath, { acquireLock: false });
    checks.push({
      id: "config",
      label: "配置文件",
      status: "ok",
      detail: `已读取 ${configPath}`
    });
  } catch (error) {
    checks.push({
      id: "config",
      label: "配置文件",
      status: "fail",
      detail: (error as Error).message
    });
    suggestions.push(`重新运行 crb setup --output ${configPath}，或检查配置文件 JSON 格式。`);
    return {
      ok: false,
      configPath,
      checks,
      suggestions,
      nextCommands: [`crb setup --output ${configPath}`],
      sessions: []
    };
  }

  try {
    const tokenEnvLooksInvalid = looksLikeDiscordToken(bridge.config.discord.tokenEnv);
    const token = tokenEnvLooksInvalid ? undefined : process.env[bridge.config.discord.tokenEnv];
    if (tokenEnvLooksInvalid) {
      checks.push({
        id: "discord-token",
        label: "Discord Token",
        status: "fail",
        detail: "discord.token_env 写成了真实 Bot token，应填写环境变量名，例如 DISCORD_BOT_TOKEN。"
      });
      suggestions.push(
        "立刻去 Discord Developer Portal 轮换 Bot token，然后把新 token 写入 .env.local，不要写进 config/bridge.local.json。"
      );
    } else if (token) {
      checks.push({
        id: "discord-token",
        label: "Discord Token",
        status: "ok",
        detail: `已找到环境变量 ${bridge.config.discord.tokenEnv}`
      });
    } else {
      checks.push({
        id: "discord-token",
        label: "Discord Token",
        status: "fail",
        detail: `未找到环境变量 ${bridge.config.discord.tokenEnv}`
      });
      suggestions.push(`在 .env.local 里设置 ${bridge.config.discord.tokenEnv}=你的 Bot token。`);
    }

    const proxy = selectProxyEnv();
    const legacyProxy = process.env.CXB_PROXY?.trim();
    if (proxy) {
      checks.push({
        id: "proxy",
        label: "网络代理",
        status: legacyProxy && proxy.name !== "CRB_PROXY" ? "warn" : "ok",
        detail: `当前使用 ${proxy.name}=${maskProxyUrl(proxy.url)}`
      });
    } else {
      checks.push({
        id: "proxy",
        label: "网络代理",
        status: legacyProxy ? "warn" : "ok",
        detail: legacyProxy
          ? "检测到旧变量 CXB_PROXY，但当前 crb 不再读取它。"
          : "未检测到代理变量；如果 Discord 连接正常，则无需设置。"
      });
    }
    if (legacyProxy && !process.env.CRB_PROXY?.trim()) {
      suggestions.push("把旧的 CXB_PROXY 改成 CRB_PROXY，例如 CRB_PROXY=http://127.0.0.1:7890。");
    }

    const discordConnection = token
      ? await new DiscordProviderAdapter(bridge.config)
          .probeConnection(token)
          .catch((error) => ({ connected: false, error: (error as Error).message }))
      : { connected: false, error: "缺少 Discord token，跳过连接测试。" };
    if (discordConnection.connected) {
      discordConnected = true;
      checks.push({
        id: "discord-api",
        label: "Discord 连接",
        status: "ok",
        detail: "Discord REST API 可以连接。"
      });
    } else {
      checks.push({
        id: "discord-api",
        label: "Discord 连接",
        status: "fail",
        detail: discordConnection.error ?? "Discord REST API 连接失败。"
      });
      suggestions.push(
        proxy
          ? "当前已经检测到代理但仍连接失败，请确认代理端口支持 Node.js 的 HTTP/Mixed 代理，并重新运行 crb doctor。"
          : "浏览器能打开 Discord 不代表 Node.js 走同一个代理；请在 .env.local 设置 CRB_PROXY 后重试。"
      );
    }

    const capability = await bridge.runtime.detect().catch(
      (error): RuntimeCapability => ({
        platform: bridge.config.runtime.windows.useWsl ? "windows-wsl" : "posix",
        available: false,
        tmuxAvailable: false,
        codexAvailable: false,
        detail: (error as Error).message
      })
    );
    const runtimeMissing = [
      capability.tmuxAvailable ? undefined : bridge.config.runtime.tmuxCommand,
      capability.codexAvailable ? undefined : bridge.config.runtime.codexCommand
    ].filter(Boolean);
    checks.push({
      id: "runtime",
      label: "tmux/Codex",
      status: capability.available ? "ok" : "fail",
      detail: capability.available
        ? `${capability.platform} 可用，tmux 和 Codex CLI 均已检测到。`
        : `运行环境不可用${runtimeMissing.length ? `：缺少 ${runtimeMissing.join(", ")}` : ""}${
            capability.detail ? `；${capability.detail}` : ""
          }`
    });
    if (!capability.available) {
      suggestions.push(
        bridge.config.runtime.windows.useWsl
          ? "在 WSL 内安装并确认 tmux、codex 可执行；Windows 主机上也要能调用 wsl.exe。"
          : "安装 tmux 和 Codex CLI，并确认当前 shell 的 PATH 可以找到它们。"
      );
    }

    const daemon = buildDaemonCommands(bridge.config, configPath);
    const daemonStatus = await runner.run(daemon.hasSession.file, daemon.hasSession.args);
    daemonRunning = daemonStatus.exitCode === 0;
    checks.push({
      id: "daemon",
      label: "后台驻留",
      status: daemonRunning ? "ok" : "warn",
      detail:
        daemonRunning
          ? `后台 tmux 会话正在运行：${daemon.sessionName}`
          : `未检测到后台 tmux 会话：${daemon.sessionName}`
    });
    if (!daemonRunning) {
      suggestions.push(`运行 crb daemon --config ${configPath}，让 Bridge 驻留在 tmux 后台。`);
    }
    if (daemonRunning && !discordConnected) {
      suggestions.push(`后台会话存在但 Discord 连接失败，优先查看 crb logs --config ${configPath} --errors；网络恢复后运行 crb restart --config ${configPath}。`);
    }

    const bindings = await bridge.bindings.listForMachine();
    checks.push({
      id: "scopes",
      label: "机器入口",
      status: bridge.config.discord.allowedScopes.length === 1 ? "ok" : "warn",
      detail:
        bridge.config.discord.allowedScopes.length === 1
          ? `已配置 1 个 parent channel/Forum：${bridge.config.discord.allowedScopes[0]?.conversationId ?? bridge.config.discord.allowedScopes[0]?.workspaceId}`
          : `当前配置了 ${bridge.config.discord.allowedScopes.length} 个 allowed_scopes；建议每台机器只拥有一个 parent 入口。`
    });
    if (bridge.config.discord.allowedScopes.length !== 1) {
      suggestions.push("把每台真实电脑的 allowed_scopes 收敛到自己的 parent channel/Forum，避免多个 Bridge 抢同一个 thread。");
    }

    const authorizedUsers = bridge.config.policy.authorizedUserIds.length;
    checks.push({
      id: "authorized-users",
      label: "授权用户",
      status: authorizedUsers > 0 ? "ok" : "warn",
      detail:
        authorizedUsers > 0
          ? `已配置 ${authorizedUsers} 个授权 Discord 用户。`
          : "未配置 authorized_user_ids，Discord 用户无法操作项目。"
    });
    if (authorizedUsers === 0) {
      suggestions.push("在 config/bridge.local.json 的 policy.authorized_user_ids 里填写允许使用的 Discord User ID。");
    }

    checks.push({
      id: "bindings",
      label: "项目绑定",
      status: bindings.length > 0 ? "ok" : "warn",
      detail:
        bindings.length > 0
          ? `当前机器已有 ${bindings.length} 个绑定。`
          : "当前机器还没有任何 Discord thread 绑定项目目录。"
    });
    if (bindings.length === 0) {
      suggestions.push("到 Discord 子区/thread 内运行 /codex bind path:<项目绝对路径> alias:<短名>。");
    }

    sessions = await Promise.all(
      bindings.map(async (binding) => {
        const session = await bridge.runtime.discoverExisting(binding);
        const status = session
          ? await bridge.runtime
              .status(session)
              .catch((error) => ({ state: "failed" as const, detail: (error as Error).message }))
          : { state: "missing" as const, detail: "没有正在运行的 tmux 会话。" };
        return {
          project: binding.projectName,
          tmuxSession: binding.runtime.tmuxSession,
          state: status.state
        };
      })
    );
    const liveSessions = sessions.filter((session) => session.state !== "missing");
    checks.push({
      id: "sessions",
      label: "项目会话",
      status: bindings.length === 0 || liveSessions.length > 0 ? "ok" : "warn",
      detail:
        bindings.length === 0
          ? "暂无绑定项目，因此没有项目 tmux 会话。"
          : `${liveSessions.length}/${bindings.length} 个绑定项目有正在运行或可恢复的会话。`
    });
    if (bindings.length > 0 && liveSessions.length === 0) {
      suggestions.push("如果项目被空闲回收，可以在 Discord thread 里发送 /codex resume 或普通消息触发恢复。");
    }
  } finally {
    await bridge.release();
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    configPath,
    machineId: bridge.config.machineId,
    checks,
    suggestions: unique(suggestions),
    nextCommands,
    sessions
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `CRB 诊断报告${report.machineId ? `（${report.machineId}）` : ""}`,
    `整体状态：${overallStatusText(report)}`,
    "",
    "检查项："
  ];
  for (const check of report.checks) {
    lines.push(`  ${statusIcon(check.status)} ${check.label}：${check.detail}`);
  }
  if (report.suggestions.length > 0) {
    lines.push("", "下一步建议：");
    for (const suggestion of report.suggestions) {
      lines.push(`  - ${suggestion}`);
    }
  }
  if (report.sessions.length > 0) {
    lines.push("", "项目会话：");
    for (const session of report.sessions) {
      lines.push(`  - ${session.project}：${session.state}（${session.tmuxSession}）`);
    }
  }
  lines.push("", "常用排查命令：");
  for (const command of report.nextCommands) {
    lines.push(`  ${command}`);
  }
  lines.push("", "需要 JSON 输出时使用：");
  lines.push(`  crb doctor --config ${report.configPath} --json`);
  return lines.join("\n");
}

function statusIcon(status: DoctorStatus): string {
  if (status === "ok") return "[OK]";
  if (status === "warn") return "[WARN]";
  return "[FAIL]";
}

function overallStatusText(report: DoctorReport): string {
  if (report.checks.some((check) => check.status === "fail")) return "需要处理";
  if (report.checks.some((check) => check.status === "warn")) return "可用，有建议";
  return "正常";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
