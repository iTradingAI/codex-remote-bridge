import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BindingRegistry } from "../src/core/bindings/binding-registry.js";
import { emptyBindings, type BindingsDocument } from "../src/storage/documents.js";
import { JsonFileStore } from "../src/storage/json-file-store.js";
import { tempDir, testConfig } from "./helpers.js";

describe("BindingRegistry", () => {
  it("binds one conversation to one machine-owned project", async () => {
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
      projectPath: dir,
      aliases: ["local"]
    });

    expect(binding.machineId).toBe("test-machine");
    expect(await registry.findByConversation({
      provider: "discord",
      workspaceId: "guild:1",
      conversationId: "channel:2"
    })).toMatchObject({ projectPath: dir });
    expect(await registry.findByAlias("local")).toMatchObject({ id: binding.id });
  });

  it("repairs mojibake before persisting project paths", async () => {
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
      projectPath: "E:\\KEHU\\202603鏄庤緣"
    });

    expect(binding.projectPath).toBe("E:\\KEHU\\202603明辉");
    expect(binding.projectName).toBe("202603明辉");
  });
});
