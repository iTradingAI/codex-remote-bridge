import { describe, expect, it } from "vitest";
import { normalizeHookEvent } from "../src/hooks/hook-ingress.js";

describe("normalizeHookEvent", () => {
  it("keeps supported MVP hook events", () => {
    expect(normalizeHookEvent({ event: "stop", text: "done" })).toMatchObject({
      event: "stop",
      text: "done"
    });
  });

  it("marks verbose events unsupported", () => {
    expect(normalizeHookEvent({ event: "post-tool-use" })).toMatchObject({
      event: "unsupported"
    });
  });
});
