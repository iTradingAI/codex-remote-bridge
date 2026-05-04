import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BindingRegistry } from "../src/core/bindings/binding-registry.js";
import { routeHookEvent } from "../src/hooks/hook-ingress.js";
import type { DiscordProviderAdapter } from "../src/providers/discord/discord-provider.js";
import { AuditLog } from "../src/storage/audit-log.js";
import { emptyBindings, type BindingsDocument } from "../src/storage/documents.js";
import { JsonFileStore } from "../src/storage/json-file-store.js";
import { tempDir, testConfig } from "./helpers.js";

describe("routeHookEvent", () => {
  it("routes supported hook events to the owning Discord conversation", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const binding = await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });

    const sent: unknown[] = [];
    const message = await routeHookEvent({
      config,
      event: {
        event: "needs-input",
        bindingId: binding.id,
        text: "Codex needs input",
        raw: {}
      },
      bindings: registry,
      audit: new AuditLog(join(dir, "audit.jsonl")),
      provider: {
        sendMessage: async (target: unknown, outbound: unknown) => {
          sent.push({ target, outbound });
        }
      } as Pick<DiscordProviderAdapter, "sendMessage"> as DiscordProviderAdapter
    });

    expect(message).toMatchObject({ kind: "status", title: "Codex needs-input" });
    expect(sent).toHaveLength(1);
  });
});
