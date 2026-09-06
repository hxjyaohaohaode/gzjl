import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

/**
 * AWS SDK v3 enables flexible request/response checksums by default. Several
 * S3-compatible providers (including Backblaze B2) do not implement those
 * AWS-specific checksum headers consistently. That can make an otherwise
 * valid presigned browser PUT or Worker PutObject fail with a signature/400
 * response.
 *
 * The application still verifies evidence and export bytes with SHA-256. This
 * only asks the SDK to send provider checksums when the S3 operation requires
 * them, which is the compatibility mode recommended by the SDK maintainers.
 */
export function createS3CompatibleClient(config: S3ClientConfig): S3Client {
  return new S3Client({
    ...config,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
