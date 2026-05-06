import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonFileStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaultValue: () => T
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.defaultValue();
      }
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await renameWithRetry(tempPath, this.filePath);
  }

  async update(mutator: (value: T) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = await mutator(await this.read());
      await this.write(next);
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(10 * attempt);
    }
  }
}

function isTransientRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
