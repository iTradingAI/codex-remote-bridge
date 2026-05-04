import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonFileStore } from "../src/storage/json-file-store.js";
import { tempDir } from "./helpers.js";

describe("JsonFileStore", () => {
  it("serializes overlapping updates in process", async () => {
    const dir = await tempDir();
    const store = new JsonFileStore<{ values: number[] }>(join(dir, "store.json"), () => ({
      values: []
    }));

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.update(async (document) => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          document.values.push(index);
          return document;
        })
      )
    );

    const document = await store.read();
    expect(document.values).toHaveLength(20);
    expect(new Set(document.values).size).toBe(20);
  });
});
