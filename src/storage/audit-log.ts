import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEvent } from "../types.js";

export class AuditLog {
  constructor(private readonly filePath: string) {}

  async append(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
