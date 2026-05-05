import { describe, expect, it } from "vitest";
import { DiscordIngressOwnership } from "../src/providers/discord/ownership.js";

describe("DiscordIngressOwnership", () => {
  it("accepts a configured channel and its threads", () => {
    const ownership = new DiscordIngressOwnership([
      { workspaceId: "guild:1", conversationId: "channel:2" }
    ]);

    expect(
      ownership.accepts({
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      }).accepted
    ).toBe(true);
    expect(
      ownership.accepts({
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2/thread:3"
      }).accepted
    ).toBe(true);
  });

  it("rejects out-of-scope conversations before routing", () => {
    const ownership = new DiscordIngressOwnership([
      { workspaceId: "guild:1", conversationId: "channel:2" }
    ]);

    expect(
      ownership.accepts({
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:9"
      }).accepted
    ).toBe(false);
  });

  it("keeps different machine parent scopes isolated", () => {
    const windows = new DiscordIngressOwnership([
      { workspaceId: "guild:1", conversationId: "channel:win" }
    ]);
    const linux = new DiscordIngressOwnership([
      { workspaceId: "guild:1", conversationId: "channel:linux" }
    ]);
    const linuxThread = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:linux/thread:project"
    };

    expect(windows.accepts(linuxThread).accepted).toBe(false);
    expect(linux.accepts(linuxThread).accepted).toBe(true);
  });
});
