import { createServer } from "node:http";

import { PutObjectCommand } from "@aws-sdk/client-s3";
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

  it("sends PutObject without unsupported flexible-checksum headers", async () => {
    let requestHeaders: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      requestHeaders = request.headers;
      request.resume();
      request.once("end", () => {
        response.statusCode = 200;
        response.setHeader("etag", '"test-etag"');
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test port");
    const client = createS3CompatibleClient({
      region: "us-east-005",
      endpoint: `http://127.0.0.1:${address.port}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
    });

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: "test-bucket",
          Key: "test-object.xlsx",
          Body: Buffer.from("workbook"),
          ContentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      expect(requestHeaders).not.toHaveProperty("x-amz-checksum-crc32");
      expect(requestHeaders).not.toHaveProperty("x-amz-sdk-checksum-algorithm");
      expect(requestHeaders).toHaveProperty("x-amz-content-sha256");
    } finally {
      client.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
