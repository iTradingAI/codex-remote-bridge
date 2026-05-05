import { readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalHookEventQueue } from "../src/hooks/local-event-queue.js";
import { tempDir } from "./helpers.js";

describe("LocalHookEventQueue", () => {
  it("queues hook events for the long-running bridge to drain", async () => {
    const dir = await tempDir();
    const queue = new LocalHookEventQueue(dir);
    await queue.enqueue({ event: "needs-input", bindingId: "binding-1", raw: {} });

    const drained: string[] = [];
    const count = await queue.drain(async (event) => {
      drained.push(event.event);
    });

    expect(count).toBe(1);
    expect(drained).toEqual(["needs-input"]);
    await expect(queue.drain(async () => undefined)).resolves.toBe(0);
  });

  it("claims queued files so overlapping drains do not handle one event twice", async () => {
    const dir = await tempDir();
    const queue = new LocalHookEventQueue(dir);
    await queue.enqueue({ event: "needs-input", bindingId: "binding-1", raw: {} });
    let handled = 0;
    const slowHandler = async () => {
      handled += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    const [first, second] = await Promise.all([queue.drain(slowHandler), queue.drain(slowHandler)]);

    expect(first + second).toBe(1);
    expect(handled).toBe(1);
  });

  it("returns claimed events to the queue when handling fails", async () => {
    const dir = await tempDir();
    const queue = new LocalHookEventQueue(dir);
    await queue.enqueue({ event: "failed", bindingId: "binding-1", raw: {} });

    await expect(
      queue.drain(async () => {
        throw new Error("temporary failure");
      })
    ).rejects.toThrow("temporary failure");

    const handled: string[] = [];
    await expect(
      queue.drain(async (event) => {
        handled.push(event.event);
      })
    ).resolves.toBe(1);
    expect(handled).toEqual(["failed"]);
  });

  it("recovers processing files left by a prior crash", async () => {
    const dir = await tempDir();
    const queue = new LocalHookEventQueue(dir);
    const filePath = await queue.enqueue({ event: "session-end", bindingId: "binding-1", raw: {} });
    await rename(filePath, `${filePath}.processing`);

    const handled: string[] = [];
    await expect(
      queue.drain(async (event) => {
        handled.push(event.event);
      })
    ).resolves.toBe(1);

    expect(handled).toEqual(["session-end"]);
  });

  it("quarantines malformed events and continues with later events", async () => {
    const dir = await tempDir();
    const queue = new LocalHookEventQueue(dir);
    await writeFile(join(dir, "000-bad.json"), "{not json", "utf8");
    await queue.enqueue({ event: "session-end", bindingId: "binding-1", raw: {} });

    const handled: string[] = [];
    await expect(
      queue.drain(async (event) => {
        handled.push(event.event);
      })
    ).rejects.toThrow();

    expect(handled).toEqual(["session-end"]);
    expect((await readdir(dir)).some((entry) => entry.endsWith(".json.failed"))).toBe(true);
  });

  it("requeues handler failures while still processing later events", async () => {
    const dir = await tempDir();
    const queue = new LocalHookEventQueue(dir);
    await writeFile(
      join(dir, "000-first.json"),
      `${JSON.stringify({ event: "failed", binding_id: "binding-1", raw: {} })}\n`,
      "utf8"
    );
    await writeFile(
      join(dir, "001-second.json"),
      `${JSON.stringify({ event: "session-end", binding_id: "binding-2", raw: {} })}\n`,
      "utf8"
    );

    const handled: string[] = [];
    await expect(
      queue.drain(async (event) => {
        if (event.bindingId === "binding-1") throw new Error("temporary failure");
        handled.push(event.event);
      })
    ).rejects.toThrow("temporary failure");

    expect(handled).toEqual(["session-end"]);
    expect((await readdir(dir)).some((entry) => entry.endsWith("000-first.json"))).toBe(true);
  });
});
