import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

/** Keep AWS flexible checksums in S3-compatible-provider mode. */
export function createS3CompatibleClient(config: S3ClientConfig): S3Client {
  return new S3Client({
    ...config,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
