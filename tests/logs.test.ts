import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRuntimeLogTail } from "../src/storage/runtime-log.js";
import { tempDir } from "./helpers.js";

describe("runtime logs", () => {
  it("tails runtime logs and can filter errors", async () => {
    const dir = await tempDir();
    const logPath = join(dir, "bridge.jsonl");
    await writeFile(
      logPath,
      [
        JSON.stringify({ at: "t1", level: "info", message: "started" }),
        JSON.stringify({ at: "t2", level: "error", message: "failed" }),
        JSON.stringify({ at: "t3", level: "info", message: "recovered" })
      ].join("\n"),
      "utf8"
    );

    await expect(readRuntimeLogTail(logPath, { lines: 2 })).resolves.toHaveLength(2);
    await expect(readRuntimeLogTail(logPath, { errorsOnly: true })).resolves.toEqual([
      JSON.stringify({ at: "t2", level: "error", message: "failed" })
    ]);
  });
});
