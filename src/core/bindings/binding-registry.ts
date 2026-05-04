import { basename } from "node:path";
import type {
  BridgeConfig,
  ConversationRef,
  PolicyConfig,
  ProjectBinding
} from "../../types.js";
import { bindingIdFromConversation, conversationKey } from "../conversation.js";
import { JsonFileStore } from "../../storage/json-file-store.js";
import type { BindingsDocument } from "../../storage/documents.js";
import { repairUtf8DecodedAsGbk } from "../../encoding/mojibake.js";

export interface BindRequest {
  conversation: ConversationRef;
  projectPath: string;
  aliases?: string[];
  policy?: Partial<PolicyConfig>;
  tmuxSession?: string;
}

export class BindingRegistry {
  constructor(
    private readonly config: BridgeConfig,
    private readonly store: JsonFileStore<BindingsDocument>
  ) {}

  async listForMachine(): Promise<ProjectBinding[]> {
    const document = await this.store.read();
    return document.bindings.filter(
      (binding) => binding.machineId === this.config.machineId && binding.enabled
    );
  }

  async findByConversation(conversation: ConversationRef): Promise<ProjectBinding | undefined> {
    const document = await this.store.read();
    return document.bindings.find(
      (binding) =>
        binding.enabled &&
        binding.machineId === this.config.machineId &&
        binding.provider === conversation.provider &&
        binding.workspaceId === conversation.workspaceId &&
        binding.conversationId === conversation.conversationId
    );
  }

  async findByAlias(alias: string): Promise<ProjectBinding | undefined> {
    const normalized = alias.toLowerCase();
    const bindings = await this.listForMachine();
    return bindings.find(
      (binding) =>
        binding.id.toLowerCase() === normalized ||
        binding.projectName.toLowerCase() === normalized ||
        binding.aliases.some((item) => item.toLowerCase() === normalized)
    );
  }

  async bind(request: BindRequest): Promise<ProjectBinding> {
    const now = new Date().toISOString();
    const id = bindingIdFromConversation(request.conversation);
    const projectPath = repairUtf8DecodedAsGbk(request.projectPath);
    const projectName = basename(projectPath);
    const nextBinding: ProjectBinding = {
      id,
      provider: request.conversation.provider,
      workspaceId: request.conversation.workspaceId,
      conversationId: request.conversation.conversationId,
      projectPath,
      projectName,
      aliases: request.aliases ?? [],
      machineId: this.config.machineId,
      runtime: {
        kind: "codex-tmux",
        tmuxSession: request.tmuxSession ?? `codex-${id}`.slice(0, 80)
      },
      policy: {
        ...this.config.policy,
        ...request.policy
      },
      enabled: true,
      createdAt: now,
      updatedAt: now
    };

    await this.store.update((document) => {
      const existing = document.bindings.findIndex(
        (binding) =>
          binding.provider === request.conversation.provider &&
          binding.workspaceId === request.conversation.workspaceId &&
          binding.conversationId === request.conversation.conversationId &&
          binding.machineId === this.config.machineId
      );
      if (existing >= 0) {
        document.bindings[existing] = {
          ...nextBinding,
          createdAt: document.bindings[existing]?.createdAt ?? now
        };
      } else {
        document.bindings.push(nextBinding);
      }
      return document;
    });

    return nextBinding;
  }

  async unbind(conversation: ConversationRef): Promise<boolean> {
    let changed = false;
    await this.store.update((document) => {
      document.bindings = document.bindings.map((binding) => {
        if (
          binding.machineId === this.config.machineId &&
          binding.provider === conversation.provider &&
          binding.workspaceId === conversation.workspaceId &&
          binding.conversationId === conversation.conversationId
        ) {
          changed = true;
          return { ...binding, enabled: false, updatedAt: new Date().toISOString() };
        }
        return binding;
      });
      return document;
    });
    return changed;
  }

  keyFor(binding: ProjectBinding): string {
    return conversationKey({
      provider: binding.provider,
      workspaceId: binding.workspaceId,
      conversationId: binding.conversationId
    });
  }
}
