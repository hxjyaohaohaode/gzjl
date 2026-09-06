import { describe, expect, it } from "vitest";

import { normalizeExportStorageFailure } from "./export-jobs.js";

describe("normalizeExportStorageFailure", () => {
  it.each([
    ["NoSuchBucket", 404, "export_storage_bucket_missing", true],
    ["InvalidAccessKeyId", 403, "export_storage_credentials_invalid", true],
    ["SignatureDoesNotMatch", 400, "export_storage_signature_invalid", true],
    ["AccessDenied", 403, "export_storage_forbidden", true],
    ["TimeoutError", 500, "export_storage_unreachable", false],
  ])(
    "maps %s safely",
    (name, status, expectedCode, expectedPermanent) => {
      expect(
        normalizeExportStorageFailure({
          name,
          $metadata: { httpStatusCode: status, requestId: "request-123" },
          message: "must not be copied into diagnostics",
          request: { headers: { authorization: "secret" } },
        }),
      ).toEqual({
        code: expectedCode,
        permanent: expectedPermanent,
        providerErrorName: name,
        providerErrorCode: null,
        httpStatusCode: status,
        requestId: "request-123",
      });
    },
  );

  it("keeps unknown failures retryable without copying raw error fields", () => {
    expect(
      normalizeExportStorageFailure({ message: "secret-bearing provider response" }),
    ).toEqual({
      code: "export_upload_failed",
      permanent: false,
      providerErrorName: null,
      providerErrorCode: null,
      httpStatusCode: null,
      requestId: null,
    });
  });
});
