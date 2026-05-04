const gbkDecoder = new TextDecoder("gbk");
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

let reverseGbkMap: Map<string, number[]> | undefined;

const COMMON_UTF8_GBK_MOJIBAKE_MARKERS = [
  "鏄",
  "庤",
  "緣",
  "涓",
  "鍙",
  "鐨",
  "瀛",
  "鏈",
  "鎴",
  "璇",
  "缃",
  "佸",
  "杈"
];

export function repairUtf8DecodedAsGbk(value: string): string {
  if (!mayContainUtf8GbkMojibake(value)) return value;
  const bytes = encodeAsGbkBytes(value);
  if (!bytes) return value;

  try {
    const repaired = utf8Decoder.decode(new Uint8Array(bytes));
    return repaired || value;
  } catch {
    return value;
  }
}

export function repairUtf8DecodedAsGbkList(values: string[]): string[] {
  return values.map((value) => repairUtf8DecodedAsGbk(value));
}

function mayContainUtf8GbkMojibake(value: string): boolean {
  return COMMON_UTF8_GBK_MOJIBAKE_MARKERS.some((marker) => value.includes(marker));
}

function encodeAsGbkBytes(value: string): number[] | undefined {
  const map = getReverseGbkMap();
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code != null && code <= 0x7f) {
      bytes.push(code);
      continue;
    }
    const mapped = map.get(char);
    if (!mapped) return undefined;
    bytes.push(...mapped);
  }
  return bytes;
}

function getReverseGbkMap(): Map<string, number[]> {
  if (reverseGbkMap) return reverseGbkMap;

  const map = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail === 0x7f) continue;
      const char = gbkDecoder.decode(new Uint8Array([lead, trail]));
      if (char.length === 1 && char !== "\ufffd" && !map.has(char)) {
        map.set(char, [lead, trail]);
      }
    }
  }

  reverseGbkMap = map;
  return map;
}
