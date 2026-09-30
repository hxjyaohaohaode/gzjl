import { sha256 } from "@noble/hashes/sha2.js";

// Hash bounded slices: a 100 MiB video never needs a 100 MiB JS buffer.
export async function hashFileSlices(file: Blob, onProgress?: ((percentage: number) => void) | undefined, signal?: AbortSignal | undefined): Promise<string> {
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < file.size; offset += 1_048_576) {
      signal?.throwIfAborted();
      const bytes = new Uint8Array(await file.slice(offset, offset + 1_048_576).arrayBuffer());
      hash.update(bytes);
      onProgress?.(Math.min(100, Math.round((offset + bytes.length) / file.size * 100)));
      // Yield between slices when running the fallback on the main thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    onProgress?.(100);
    return [...hash.digest()].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } finally { hash.destroy(); }
}
