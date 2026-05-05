import { describe, expect, it } from "vitest";
import { formatCliError, isNetworkError } from "../src/cli/errors.js";

describe("CLI errors", () => {
  it("formats Discord network timeouts without a stack trace", () => {
    const error = Object.assign(
      new Error(
        "Connect Timeout Error (attempted addresses: 2a03:2880:f10d:183:face:b00c:0:25de:443, 31.13.95.35:443, timeout: 10000ms)"
      ),
      { code: "UND_ERR_CONNECT_TIMEOUT" }
    );

    expect(isNetworkError(error)).toBe(true);
    expect(formatCliError(error)).toContain("Network error while contacting Discord.");
    expect(formatCliError(error)).toContain("https://discord.com/api");
    expect(formatCliError(error)).not.toMatch(/\n\s+at\s/);
  });
});
