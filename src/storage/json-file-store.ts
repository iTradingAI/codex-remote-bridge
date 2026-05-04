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
    await rename(tempPath, this.filePath);
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
