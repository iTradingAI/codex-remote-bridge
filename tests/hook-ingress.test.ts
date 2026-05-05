import { describe, expect, it } from "vitest";
import { normalizeHookEvent } from "../src/hooks/hook-ingress.js";

describe("normalizeHookEvent", () => {
  it("keeps supported MVP hook events", () => {
    expect(normalizeHookEvent({ event: "stop", text: "done" })).toMatchObject({
      event: "stop",
      text: "done"
    });
  });

  it("normalizes hook conversation references", () => {
    expect(
      normalizeHookEvent({
        event: "needs-input",
        conversation: {
          provider: "discord",
          workspaceId: "guild:1",
          conversationId: "channel:2/thread:3"
        }
      })
    ).toMatchObject({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2/thread:3"
      }
    });
  });

  it("marks verbose events unsupported", () => {
    expect(normalizeHookEvent({ event: "post-tool-use" })).toMatchObject({
      event: "unsupported"
    });
  });
});
