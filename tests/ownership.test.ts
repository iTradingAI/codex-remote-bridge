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
});
