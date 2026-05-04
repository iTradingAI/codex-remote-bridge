import { open, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export class ProcessLock {
  private released = false;

  private constructor(
    private readonly filePath: string,
    private readonly handle: FileHandle
  ) {}

  static async acquire(filePath: string): Promise<ProcessLock> {
    await mkdir(dirname(filePath), { recursive: true });
    let handle: FileHandle;
    try {
      handle = await open(filePath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Bridge data directory is already locked: ${filePath}`);
      }
      throw error;
    }
    await handle.writeFile(`${process.pid}\n`, "utf8");
    const lock = new ProcessLock(filePath, handle);
    process.once("exit", () => {
      lock.releaseSyncBestEffort();
    });
    return lock;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.handle.close();
    await unlink(this.filePath).catch(() => undefined);
  }

  private releaseSyncBestEffort(): void {
    if (this.released) return;
    this.released = true;
    void this.handle.close();
    void unlink(this.filePath).catch(() => undefined);
  }
}
