import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProcessLock } from "../src/storage/process-lock.js";
import { tempDir } from "./helpers.js";

describe("ProcessLock", () => {
  it("prevents two bridge instances from sharing one data directory", async () => {
    const dir = await tempDir();
    const lockPath = join(dir, ".bridge.lock");
    const first = await ProcessLock.acquire(lockPath);
    await expect(ProcessLock.acquire(lockPath)).rejects.toThrow(/already locked/);
    await first.release();
    const second = await ProcessLock.acquire(lockPath);
    await second.release();
  });
});
