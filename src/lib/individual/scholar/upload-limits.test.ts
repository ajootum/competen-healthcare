import { describe, expect, it } from "vitest";
import { DEFAULT_UPLOAD_MB, MAX_SESSION_FILES, MAX_SESSION_MB, MAX_UPLOAD_BYTES, sessionRefusal, uploadRules } from "./config";
import { DEFAULT_POLICY, resolvePolicy, policyPath } from "../policy";

// Upload limits (owner GO 2026-10-24, COMPETEN-SCHOLAR-UPLOAD-01 Stage 2 acceptance): a 25 MB ceiling per file
// (migration 413), the live value unchanged until HQ raises it, and an upload session of 10 files and 100 MB.

const MB = 1024 * 1024;

describe("upload limits", () => {
  it("raises the ceiling to 25 MB but keeps the live value at 10 MB until HQ changes it", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * MB);
    expect(DEFAULT_POLICY.scholarUploadMaxMb).toBe(DEFAULT_UPLOAD_MB);
    expect(uploadRules(DEFAULT_POLICY).maxMb).toBe(10);
    const raised = resolvePolicy([{ config_path: policyPath("scholar_upload_max_mb"), published: { value: 25 } }]);
    expect(uploadRules(raised).maxBytes).toBe(25 * MB);
    // Never above the ceiling, whatever is stored.
    expect(uploadRules({ scholarUploadFormats: ["pdf"], scholarUploadMaxMb: 40 }).maxBytes).toBe(25 * MB);
  });

  it("a session is 10 files and 100 MB by default, and policy can only tighten it", () => {
    const r = uploadRules(DEFAULT_POLICY);
    expect([r.sessionFiles, r.sessionMb]).toEqual([MAX_SESSION_FILES, MAX_SESSION_MB]);
    expect(uploadRules({ ...DEFAULT_POLICY, scholarUploadSessionFiles: 50, scholarUploadSessionMb: 900 })).toMatchObject({ sessionFiles: 10, sessionMb: 100 });
    // A session never holds less than one file at the size limit.
    expect(uploadRules({ ...DEFAULT_POLICY, scholarUploadMaxMb: 25, scholarUploadSessionMb: 10 }).sessionMb).toBe(25);
  });

  it("refuses the file that would take the session over its count or its size, and says which", () => {
    const r = uploadRules(DEFAULT_POLICY);
    expect(sessionRefusal(r, { count: 9, bytes: 80 * MB }, 10 * MB)).toBeNull();
    expect(sessionRefusal(r, { count: 10, bytes: 10 * MB }, MB)).toMatch(/10 files in the last hour/);
    expect(sessionRefusal(r, { count: 3, bytes: 95 * MB }, 10 * MB)).toMatch(/over 100 MB/);
  });
});
