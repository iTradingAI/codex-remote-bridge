import { createHash } from "node:crypto";
import type { AuditLog } from "../../storage/audit-log.js";
import type { ApprovalStore } from "../../storage/approval-store.js";
import type { ExecutionStateStore } from "../../storage/execution-state-store.js";
import type { BindingRegistry } from "../bindings/binding-registry.js";
import type { PolicyGuard } from "../policy/policy-guard.js";
import type { ProjectPathGuard } from "../policy/project-path-guard.js";
import type { CodexRuntime } from "../../runtime/codex-tmux/codex-tmux-runtime.js";
import type {
  BridgeConfig,
  ConversationRef,
  InboundCommand,
  OutboundMessage,
  OutboundSink,
  ProjectBinding,
  RuntimeSession
} from "../../types.js";

type ApprovalPayload =
  | {
      kind: "bind";
      conversation: ConversationRef;
      projectPath: string;
      aliases: string[];
    }
  | {
      kind: "send";
      bindingId: string;
      textHash: string;
    };

export class CommandRouter {
  private readonly sensitiveSendText = new Map<string, string>();
  private readonly bindingQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly config: BridgeConfig,
    private readonly bindings: BindingRegistry,
    private readonly pathGuard: ProjectPathGuard,
    private readonly policy: PolicyGuard,
    private readonly approvals: ApprovalStore,
    private readonly runtime: CodexRuntime,
    private readonly executionStates: ExecutionStateStore,
    private readonly audit: AuditLog
  ) {}

  async handle(command: InboundCommand, sink?: OutboundSink): Promise<OutboundMessage> {
    try {
      switch (command.command) {
        case "bind":
          return await this.bind(command);
        case "confirm":
          return await this.confirm(command);
        case "unbind":
          return await this.unbind(command);
        case "status":
          return await this.status(command);
        case "start":
        case "resume":
          return await this.start(command);
        case "pin":
          return await this.pin(command);
        case "unpin":
          return await this.unpin(command);
        case "send":
          return await this.send(command, sink);
        case "projects":
          return await this.projects(command);
        default:
          return { kind: "error", text: "Unknown command." };
      }
    } catch (error) {
      await this.auditCommand(command, false, `error: ${(error as Error).message}`);
      return { kind: "error", text: (error as Error).message };
    }
  }

  private async bind(command: InboundCommand): Promise<OutboundMessage> {
    const projectPath = stringArg(command, "path");
    const alias = command.args.alias;
    const validation = await this.pathGuard.validate(projectPath);
    if (!validation.allowed || !validation.resolvedPath) {
      await this.auditCommand(command, false, validation.reason ?? "path rejected");
      return { kind: "error", text: validation.reason ?? "Project path rejected." };
    }

    if (!this.config.policy.authorizedUserIds.includes(command.actor.id)) {
      await this.auditCommand(command, false, "unauthorized bind");
      return { kind: "error", text: "User is not authorized to bind projects." };
    }

    const payload: ApprovalPayload = {
      kind: "bind",
      conversation: command.conversation,
      projectPath: validation.resolvedPath,
      aliases: typeof alias === "string" ? [alias] : []
    };
    const approval = await this.approvals.create({
      bindingId: "pending-bind",
      actorId: command.actor.id,
      originalText: JSON.stringify(payload)
    });
    await this.auditCommand(command, false, "bind pending confirmation");
    return {
      kind: "approval",
      title: "Confirm project binding",
      text: `Reply with /codex confirm code:${approval.code} within 10 minutes to bind ${validation.resolvedPath}.`
    };
  }

  private async confirm(command: InboundCommand): Promise<OutboundMessage> {
    const code = stringArg(command, "code");
    const approval = await this.approvals.consume(code, command.actor.id);
    if (!approval) {
      await this.auditCommand(command, false, "approval missing or expired");
      return { kind: "error", text: "Confirmation code is missing, expired, or not yours." };
    }

    const payload = JSON.parse(approval.originalText) as ApprovalPayload;
    if (payload.kind === "bind") {
      const binding = await this.bindings.bind({
        conversation: payload.conversation,
        projectPath: payload.projectPath,
        aliases: payload.aliases
      });
      await this.executionStates.set(binding, "idle");
      await this.auditCommand(command, true, `binding confirmed ${binding.id}`);
      return {
        kind: "status",
        title: "Project bound",
        text: `${binding.projectName} is now bound to this conversation.`,
        fields: [
          { label: "machine", value: binding.machineId },
          { label: "path", value: binding.projectPath }
        ]
      };
    }

    const binding = await this.findBindingById(payload.bindingId);
    const text = this.sensitiveSendText.get(approval.id);
    if (!text) {
      await this.auditCommand(command, false, "confirmed send text missing", binding);
      return {
        kind: "error",
        text: "The pending send text is no longer available. Send the command again."
      };
    }
    this.sensitiveSendText.delete(approval.id);
    try {
      await this.runForBinding(binding, async () => {
        await this.executionStates.set(binding, "executing", "Confirmed high-risk send.");
        const session = await this.runtime.ensureSession(binding);
        await this.runtime.send(session, text);
        await this.executionStates.set(binding, "completed", "Confirmed text was sent.");
      });
    } catch (error) {
      await this.executionStates.set(binding, "failed", (error as Error).message);
      throw error;
    }
    await this.auditCommand(command, true, "confirmed high-risk send", binding, text);
    return { kind: "status", text: "Confirmed text was sent to Codex." };
  }

  private async unbind(command: InboundCommand): Promise<OutboundMessage> {
    const binding = await this.requireBinding(command);
    const auth = this.policy.canStart(command.actor, binding);
    if (!auth.allowed) {
      await this.auditCommand(command, false, auth.reason ?? "unbind denied", binding);
      return { kind: "error", text: auth.reason ?? "Not authorized." };
    }
    const session = await this.runtime.discoverExisting(binding);
    if (session) {
      await this.runtime.stop(session);
    }
    const removed = await this.bindings.unbind(command.conversation);
    await this.executionStates.set(binding, "idle", "Binding was removed.");
    await this.auditCommand(command, removed, removed ? "binding disabled" : "binding not found", binding);
    return {
      kind: "status",
      title: "Project unbound",
      text: removed ? "This conversation is no longer bound." : "No binding was changed."
    };
  }

  private async status(command: InboundCommand): Promise<OutboundMessage> {
    const binding = await this.requireBinding(command);
    const auth = this.policy.canStatus(command.actor, binding);
    if (!auth.allowed) {
      await this.auditCommand(command, false, auth.reason ?? "status denied", binding);
      return { kind: "error", text: auth.reason ?? "Not authorized." };
    }

    const discovered = await this.runtime.discoverExisting(binding);
    const status = discovered
      ? await this.runtime.status(discovered)
      : { state: "missing" as const, detail: "No tmux session is running." };
    const recent = discovered
      ? await this.runtime.readRecent(discovered, 40).catch(() => "")
      : "";
    const execution = await this.executionStates.get(binding, { liveSessionMissing: !discovered });
    await this.auditCommand(command, true, `status ${status.state}`, binding);
    return {
      kind: "status",
      title: "Codex session status",
      text: recent || status.detail || status.state,
      fields: [
        { label: "project", value: binding.projectName },
        { label: "machine", value: binding.machineId },
        { label: "parent scope", value: ownedParentScope(this.config) },
        { label: "session mode", value: binding.sessionMode },
        { label: "tmux state", value: status.state },
        { label: "execution state", value: `${execution.state} (${execution.updatedAt})` },
        { label: "path", value: binding.projectPath }
      ]
    };
  }

  private async start(command: InboundCommand): Promise<OutboundMessage> {
    const binding = await this.requireBinding(command);
    const auth = this.policy.canStart(command.actor, binding);
    if (!auth.allowed) {
      await this.auditCommand(command, false, auth.reason ?? "start denied", binding);
      return { kind: "error", text: auth.reason ?? "Not authorized." };
    }

    let session: RuntimeSession;
    try {
      await this.executionStates.set(binding, "executing", "Ensuring Codex session.");
      session = await this.runtime.ensureSession(binding);
      await this.executionStates.set(binding, "completed", "Codex session is ready.");
    } catch (error) {
      await this.executionStates.set(binding, "failed", (error as Error).message);
      throw error;
    }
    await this.auditCommand(command, true, `session ensured ${session.tmuxSession}`, binding);
    return {
      kind: "status",
      title: "Codex session ready",
      text: `tmux session ${session.tmuxSession} is ready.`,
      fields: [
        { label: "project", value: binding.projectName },
        { label: "session mode", value: binding.sessionMode },
        { label: "path", value: binding.projectPath }
      ]
    };
  }

  private async pin(command: InboundCommand): Promise<OutboundMessage> {
    const binding = await this.requireBinding(command);
    const auth = this.policy.canStart(command.actor, binding);
    if (!auth.allowed) {
      await this.auditCommand(command, false, auth.reason ?? "pin denied", binding);
      return { kind: "error", text: auth.reason ?? "Not authorized." };
    }

    const pinned = await this.bindings.setSessionMode(binding, "pinned");
    let session: RuntimeSession;
    try {
      await this.executionStates.set(pinned, "executing", "Pinning session.");
      session = await this.runtime.ensureSession(pinned);
      await this.executionStates.set(pinned, "completed", "Session pinned.");
    } catch (error) {
      await this.executionStates.set(pinned, "failed", (error as Error).message);
      throw error;
    }
    await this.auditCommand(command, true, `session pinned ${session.tmuxSession}`, pinned);
    return {
      kind: "status",
      title: "Codex session pinned",
      text: `tmux session ${session.tmuxSession} will stay resident.`,
      fields: [
        { label: "project", value: pinned.projectName },
        { label: "session mode", value: pinned.sessionMode },
        { label: "path", value: pinned.projectPath }
      ]
    };
  }

  private async unpin(command: InboundCommand): Promise<OutboundMessage> {
    const binding = await this.requireBinding(command);
    const auth = this.policy.canStart(command.actor, binding);
    if (!auth.allowed) {
      await this.auditCommand(command, false, auth.reason ?? "unpin denied", binding);
      return { kind: "error", text: auth.reason ?? "Not authorized." };
    }

    const unpinned = await this.bindings.setSessionMode(binding, "on_demand");
    const session = await this.runtime.discoverExisting(unpinned);
    if (session) {
      await this.runtime.stop(session);
    }
    await this.executionStates.set(unpinned, "idle", "Session unpinned.");
    await this.auditCommand(command, true, "session unpinned", unpinned);
    return {
      kind: "status",
      title: "Codex session unpinned",
      text: session
        ? "This project is back to on-demand mode and the resident session was stopped."
        : "This project is back to on-demand mode.",
      fields: [
        { label: "project", value: unpinned.projectName },
        { label: "session mode", value: unpinned.sessionMode },
        { label: "path", value: unpinned.projectPath }
      ]
    };
  }

  private async send(command: InboundCommand, sink?: OutboundSink): Promise<OutboundMessage> {
    const binding = await this.requireBinding(command);
    const text = stringArg(command, "text");
    if (command.rawText && !this.policy.canDirectInject(binding)) {
      await this.auditCommand(command, false, "direct injection disabled", binding, text);
      return {
        kind: "error",
        text: "Direct message injection is disabled for this binding. Use /codex send instead."
      };
    }

    await this.executionStates.set(binding, "received", "Message received from Discord.");
    const decision = this.policy.canSend(command.actor, binding, text);
    if (decision.requiresConfirmation) {
      const approval = await this.approvals.create({
        bindingId: binding.id,
        actorId: command.actor.id,
        originalText: JSON.stringify({
          kind: "send",
          bindingId: binding.id,
          textHash: promptHash(text)
        })
      });
      this.sensitiveSendText.set(approval.id, text);
      await this.executionStates.set(binding, "waiting_input", "High-risk confirmation required.");
      await this.auditCommand(
        command,
        false,
        decision.reason ?? "send pending confirmation",
        binding,
        text
      );
      return {
        kind: "approval",
        title: "High-risk confirmation required",
        text: `Reply with /codex confirm code:${approval.code} to send this message.`
      };
    }
    if (!decision.allowed) {
      await this.auditCommand(command, false, decision.reason ?? "send denied", binding, text);
      return { kind: "error", text: decision.reason ?? "Not authorized." };
    }

    let recent = "";
    try {
      await this.executionStates.set(binding, "queued", "Send accepted for Codex.");
      if (this.bindingQueues.has(binding.id)) {
        await sink?.update({
          kind: "status",
          title: "Queued",
          text: "This project is busy. Your message is queued and will run after the current Codex task finishes."
        });
      }
      recent = await this.runForBinding(binding, async () => {
        await this.executionStates.set(binding, "executing", "Sending text to Codex.");
        await sink?.update({
          kind: "status",
          title: "Codex Running",
          text: "Codex has started working on this message."
        });
        const session = await this.runtime.ensureSession(binding);
        return await this.runtime.sendAndWaitForOutput(session, text, {
          timeoutMs: 600000,
          pollMs: 1000,
          lines: 300,
          updateIntervalMs: 5000,
          onUpdate: (output) =>
            sink?.update({
              kind: "summary",
              title: "Codex Progress",
              text: output
            })
        });
      });
      await this.executionStates.set(
        binding,
        "completed",
        recent ? "Codex output captured." : "Text sent."
      );
    } catch (error) {
      await this.executionStates.set(binding, "failed", (error as Error).message);
      throw error;
    }
    await this.auditCommand(command, true, "sent text to codex", binding, text);
    return {
      kind: "summary",
      title: recent ? "Codex Output" : "Sent to Codex",
      text: recent || "Message sent. No Codex output was captured yet."
    };
  }

  private async projects(command: InboundCommand): Promise<OutboundMessage> {
    const projects = await this.bindings.listForMachine();
    const authorized = projects.filter(
      (binding) => this.policy.canStatus(command.actor, binding).allowed
    );
    if (authorized.length === 0) {
      await this.auditCommand(command, false, "projects denied or empty");
      return { kind: "error", text: "No authorized projects are available on this machine." };
    }
    await this.auditCommand(command, true, `projects listed ${authorized.length}`);
    return {
      kind: "status",
      title: "Bound projects",
      text: authorized
        .map((binding) => `${binding.projectName} [${binding.sessionMode}]: ${binding.projectPath}`)
        .join("\n")
    };
  }

  private async requireBinding(command: InboundCommand): Promise<ProjectBinding> {
    const binding = await this.bindings.findByConversation(command.conversation);
    if (!binding) {
      throw new Error("This conversation is not bound to a project.");
    }
    return binding;
  }

  private async findBindingById(id: string): Promise<ProjectBinding> {
    const bindings = await this.bindings.listForMachine();
    const binding = bindings.find((item) => item.id === id);
    if (!binding) throw new Error(`Binding not found: ${id}`);
    return binding;
  }

  private auditCommand(
    command: InboundCommand,
    allowed: boolean,
    summary: string,
    binding?: ProjectBinding,
    prompt?: string
  ) {
    return this.audit.append({
      at: new Date().toISOString(),
      machineId: this.config.machineId,
      conversation: command.conversation,
      actor: command.actor,
      bindingId: binding?.id,
      promptHash: prompt ? promptHash(prompt) : undefined,
      action: command.command,
      allowed,
      summary
    });
  }

  private async runForBinding<T>(binding: ProjectBinding, work: () => Promise<T>): Promise<T> {
    const previous = this.bindingQueues.get(binding.id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    this.bindingQueues.set(binding.id, current);

    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.bindingQueues.get(binding.id) === current) {
        this.bindingQueues.delete(binding.id);
      }
    }
  }
}

function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function stringArg(command: InboundCommand, name: string): string {
  const value = command.args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function ownedParentScope(config: BridgeConfig): string {
  return config.discord.allowedScopes[0]?.conversationId ?? "not configured";
}
