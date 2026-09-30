import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashFileSlices } from "./evidence-hash-core.js";

describe("bounded evidence hashing", () => {
  it("matches standard SHA-256 for empty, text and multi-slice binary files without reading a whole file buffer", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from("证据\nabc"), Buffer.alloc(2_500_001, 157)]) {
      const progress: number[] = [];
      const blob = new Blob([bytes]);
      blob.arrayBuffer = () => { throw new Error("Whole-file allocation is forbidden"); };
      expect(await hashFileSlices(blob, (p) => progress.push(p))).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(progress.at(-1)).toBe(100); expect(progress.every((p, i) => p >= (progress[i - 1] ?? 0))).toBe(true);
    }
  });
  it("stops promptly on cancellation between slices", async () => {
    const controller = new AbortController();
    await expect(hashFileSlices(new Blob([new Uint8Array(3_000_000)]), () => controller.abort(), controller.signal)).rejects.toThrow();
  });
});
