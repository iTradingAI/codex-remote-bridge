import { open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { unlinkSync } from "node:fs";

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
        if (await removeStaleLock(filePath)) {
          handle = await open(filePath, "wx");
        } else {
          throw new Error(`Bridge data directory is already locked: ${filePath}`);
        }
      } else {
        throw error;
      }
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
    try {
      unlinkSync(this.filePath);
    } catch {
      // Best effort during process shutdown.
    }
  }
}

async function removeStaleLock(filePath: string): Promise<boolean> {
  const pid = Number((await readFile(filePath, "utf8").catch(() => "")).trim());
  if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
    return false;
  }
  await unlink(filePath).catch(() => undefined);
  return true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}
