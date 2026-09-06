import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";

import { createS3CompatibleClient } from "./s3-compatible-client.js";

describe("createS3CompatibleClient", () => {
  it("uses the checksum compatibility mode required by non-AWS S3 providers", async () => {
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

  it("does not sign an empty automatic CRC checksum into browser upload URLs", async () => {
    const client = createS3CompatibleClient({
      region: "us-east-005",
      endpoint: "https://s3.us-east-005.backblazeb2.com",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
    });
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: "test-bucket",
        Key: "test-object",
        ContentLength: 12,
        ContentType: "application/octet-stream",
      }),
      { expiresIn: 900 },
    );

    const signedUrl = new URL(url);
    expect(signedUrl.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(signedUrl.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    client.destroy();
  });
});
