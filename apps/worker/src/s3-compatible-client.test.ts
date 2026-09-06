import { describe, expect, it } from "vitest";

import { createS3CompatibleClient } from "./s3-compatible-client.js";

describe("createS3CompatibleClient", () => {
  it("does not opt S3-compatible uploads into AWS-only automatic checksums", async () => {
    const client = createS3CompatibleClient({
      region: "us-east-005",
      endpoint: "https://s3.us-east-005.backblazeb2.com",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
    });

    await expect(client.config.requestChecksumCalculation()).resolves.toBe(
      "WHEN_REQUIRED",
    );
    await expect(client.config.responseChecksumValidation()).resolves.toBe(
      "WHEN_REQUIRED",
    );
    client.destroy();
  });
});
