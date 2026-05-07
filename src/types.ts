export type ProviderName = "discord" | "telegram" | "feishu";

export interface ConversationRef {
  provider: ProviderName;
  workspaceId: string;
  conversationId: string;
}

export interface ProviderMessageRef extends ConversationRef {
  messageId: string;
}

export interface InboundActor {
  id: string;
  name?: string;
}

export type CommandName =
  | "bind"
  | "confirm"
  | "unbind"
  | "status"
  | "start"
  | "resume"
  | "pin"
  | "unpin"
  | "send"
  | "projects"
  | "use"
  | "unknown";

export interface InboundCommand {
  conversation: ConversationRef;
  actor: InboundActor;
  command: CommandName;
  args: Record<string, string | boolean | undefined>;
  rawText?: string;
  messageId?: string;
}

export interface InboundMessage {
  conversation: ConversationRef;
  actor: InboundActor;
  text: string;
  messageId: string;
  isCommand: boolean;
  raw: unknown;
}

export interface OutboundField {
  label: string;
  value: string;
}

export interface OutboundAction {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "success" | "danger";
}

export interface OutboundMessage {
  kind: "status" | "question" | "error" | "summary" | "approval";
  title?: string;
  text: string;
  fields?: OutboundField[];
  actions?: OutboundAction[];
}

export interface OutboundSink {
  update(message: OutboundMessage): Promise<void>;
}

export interface AllowedScope {
  workspaceId: string;
  conversationId?: string;
}

export interface DiscordConfig {
  tokenEnv: string;
  applicationId: string;
  guildId?: string;
  allowedScopes: AllowedScope[];
}

export interface RuntimeWindowsConfig {
  useWsl: boolean;
  wslCommand: string;
  distro?: string;
}

export interface RuntimeConfig {
  kind: "codex-tmux";
  tmuxCommand: string;
  codexCommand: string;
  windows: RuntimeWindowsConfig;
}

export interface PolicyConfig {
  authorizedUserIds: string[];
  allowDirectInjection: boolean;
  requireConfirmationFor: string[];
}

export type SessionMode = "on_demand" | "pinned";

export type ExecutionStateName =
  | "idle"
  | "received"
  | "queued"
  | "thinking"
  | "executing"
  | "waiting_input"
  | "completed"
  | "failed";

export interface BridgeConfig {
  machineId: string;
  dataDir: string;
  logDir: string;
  discord: DiscordConfig;
  pathAllowlist: string[];
  runtime: RuntimeConfig;
  policy: PolicyConfig;
}

export interface ProjectBinding {
  id: string;
  provider: ProviderName;
  workspaceId: string;
  conversationId: string;
  projectPath: string;
  projectName: string;
  aliases: string[];
  machineId: string;
  runtime: {
    kind: "codex-tmux";
    tmuxSession: string;
    launch?: string;
  };
  sessionMode: SessionMode;
  policy: PolicyConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BindingExecutionState {
  bindingId: string;
  machineId: string;
  state: ExecutionStateName;
  detail?: string;
  updatedAt: string;
}

export interface RuntimeSession {
  bindingId: string;
  machineId: string;
  projectPath: string;
  tmuxSession: string;
  paneId?: string;
  startedAt?: string;
  lastSeenAt: string;
  outputCursor?: RuntimeOutputCursor;
  resumeHint?: "last";
  stoppedAt?: string;
}

export interface RuntimeOutputCursor {
  tail: string;
  updatedAt: string;
  messageId?: string;
}

export type SessionState =
  | "missing"
  | "starting"
  | "running"
  | "waiting_input"
  | "paused"
  | "completed"
  | "failed"
  | "stale";

export interface SessionStatus {
  state: SessionState;
  detail?: string;
  session?: RuntimeSession;
}

export interface RuntimeCapability {
  platform: "posix" | "windows-wsl";
  available: boolean;
  codexAvailable: boolean;
  tmuxAvailable: boolean;
  detail?: string;
}

export interface AuditEvent {
  at: string;
  machineId: string;
  conversation?: ConversationRef;
  actor?: InboundActor;
  bindingId?: string;
  promptHash?: string;
  action: string;
  allowed: boolean;
  summary: string;
}

export interface PendingApproval {
  id: string;
  bindingId: string;
  actorId: string;
  originalText: string;
  code: string;
  expiresAt: string;
  createdAt: string;
}

export interface HookEvent {
  event:
    | "session-start"
    | "needs-input"
    | "stop"
    | "session-end"
    | "failed"
    | "unsupported";
  conversation?: ConversationRef;
  bindingId?: string;
  text?: string;
  raw: unknown;
}
