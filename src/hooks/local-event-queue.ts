import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HookEvent } from "../types.js";
import { normalizeHookEvent } from "./hook-ingress.js";

export class LocalHookEventQueue {
  private draining = false;

  constructor(private readonly directory: string) {}

  async enqueue(event: HookEvent): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const filePath = join(this.directory, `${Date.now()}-${randomUUID()}.json`);
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(event)}\n`, "utf8");
    await rename(tempPath, filePath);
    return filePath;
  }

  async drain(handler: (event: HookEvent) => Promise<void>): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      return await this.drainOnce(handler);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(handler: (event: HookEvent) => Promise<void>): Promise<number> {
    await mkdir(this.directory, { recursive: true });
    await this.recoverProcessingFiles();
    const entries = (await readdir(this.directory))
      .filter((entry) => entry.endsWith(".json") && !entry.includes(".processing"))
      .sort();
    let handled = 0;
    let firstError: Error | undefined;
    for (const entry of entries) {
      const filePath = join(this.directory, entry);
      const processingPath = `${filePath}.processing`;
      try {
        await rename(filePath, processingPath);
      } catch {
        continue;
      }
      const event = await this.readProcessingEvent(processingPath, filePath).catch((error) => {
        firstError ??= error as Error;
        return undefined;
      });
      if (!event) continue;
      try {
        await handler(event);
        await rm(processingPath, { force: true });
      } catch (error) {
        await rename(processingPath, filePath).catch(() => undefined);
        firstError ??= error as Error;
        continue;
      }
      handled += 1;
    }
    if (firstError) throw firstError;
    return handled;
  }

  private async readProcessingEvent(processingPath: string, filePath: string): Promise<HookEvent> {
    try {
      return normalizeHookEvent(JSON.parse(await readFile(processingPath, "utf8")) as unknown);
    } catch (error) {
      await rename(processingPath, `${filePath}.failed`).catch(() => undefined);
      throw error;
    }
  }

  private async recoverProcessingFiles(): Promise<void> {
    const entries = await readdir(this.directory);
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json.processing"))
        .map(async (entry) => {
          const processingPath = join(this.directory, entry);
          const filePath = join(this.directory, entry.slice(0, -".processing".length));
          await rename(processingPath, filePath).catch(() => undefined);
        })
    );
  }
}
