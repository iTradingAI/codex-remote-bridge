import { describe, expect, it } from "vitest";
import {
  repairUtf8DecodedAsGbk,
  repairUtf8DecodedAsGbkList
} from "../src/encoding/mojibake.js";
import { normalizePath } from "../src/core/policy/project-path-guard.js";

describe("mojibake repair", () => {
  it("repairs Chinese paths decoded as GBK instead of UTF-8", () => {
    expect(repairUtf8DecodedAsGbk("E:\\KEHU\\202603鏄庤緣")).toBe("E:\\KEHU\\202603明辉");
  });

  it("leaves normal paths unchanged", () => {
    expect(repairUtf8DecodedAsGbkList(["E:\\Projects", "E:\\KEHU\\202603明辉"])).toEqual([
      "E:\\Projects",
      "E:\\KEHU\\202603明辉"
    ]);
  });

  it("repairs mojibake during path normalization", () => {
    expect(normalizePath("E:\\KEHU\\202603鏄庤緣")).toBe("e:/kehu/202603明辉");
  });
});
