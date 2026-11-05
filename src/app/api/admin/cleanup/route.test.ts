/**
 * Tests for POST /api/admin/cleanup and GET /api/admin/cleanup
 *
 * The retention engine itself is covered by src/lib/retention/purge.test.ts.
 * Here we verify:
 *  - Unauthenticated callers receive 403.
 *  - Admin session grants access.
 *  - Bearer tokens (CLEANUP_SECRET, CRON_SECRET, AUTH_SECRET) grant access.
 *  - GET is always a dry run.
 *  - POST defaults to dry run; passes dryRun:false through when explicitly set.
 *  - Invalid JSON body returns 400.
 *  - Unknown `only` targets are silently filtered out.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (must precede the subject import)
// ---------------------------------------------------------------------------

const { mockRunRetention } = vi.hoisted(() => ({
  mockRunRetention: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

vi.mock("@/lib/retention/purge", () => ({
  runRetention: mockRunRetention,
}));

import { auth } from "@/auth";
import { GET, POST } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_SESSION = { user: { roles: ["ADMIN"] } };

function makeRequest(
  method: "GET" | "POST",
  {
    body,
    bearer,
    search = "",
  }: { body?: unknown; bearer?: string; search?: string } = {},
): NextRequest {
  const url = `http://localhost/api/admin/cleanup${search}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const MOCK_REPORT = {
  dryRun: true,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  outcomes: [],
  totalAffected: 0,
  hadErrors: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockRunRetention.mockResolvedValue(MOCK_REPORT);
});

describe("GET /api/admin/cleanup", () => {
  it("returns 403 for unauthenticated callers", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(403);
    expect(mockRunRetention).not.toHaveBeenCalled();
  });

  it("returns 403 when session exists but user is not ADMIN", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { roles: ["USER"] } } as any);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(403);
  });

  it("permits an ADMIN session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    expect(mockRunRetention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("permits a valid CLEANUP_SECRET bearer token", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    vi.stubEnv("CLEANUP_SECRET", "s3cr3t");
    const res = await GET(makeRequest("GET", { bearer: "s3cr3t" }));
    expect(res.status).toBe(200);
  });

  it("permits a valid CRON_SECRET bearer token", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    vi.stubEnv("CRON_SECRET", "cron-pass");
    const res = await GET(makeRequest("GET", { bearer: "cron-pass" }));
    expect(res.status).toBe(200);
  });

  it("permits a valid AUTH_SECRET bearer token", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    vi.stubEnv("AUTH_SECRET", "auth-secret");
    const res = await GET(makeRequest("GET", { bearer: "auth-secret" }));
    expect(res.status).toBe(200);
  });

  it("rejects an unknown bearer token", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    vi.stubEnv("CLEANUP_SECRET", "real-secret");
    const res = await GET(makeRequest("GET", { bearer: "wrong-secret" }));
    expect(res.status).toBe(403);
  });

  it("always passes dryRun:true regardless of search params", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await GET(makeRequest("GET"));
    expect(mockRunRetention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("forwards batchSize from search params", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await GET(makeRequest("GET", { search: "?batchSize=100" }));
    expect(mockRunRetention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchSize: 100 }),
    );
  });

  it("forwards valid only targets from search params", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await GET(makeRequest("GET", { search: "?only=auditLog,findingSnippet" }));
    const opts = mockRunRetention.mock.calls[0][1];
    expect(opts.only).toEqual(["auditLog", "findingSnippet"]);
  });

  it("filters out unknown only targets", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await GET(makeRequest("GET", { search: "?only=auditLog,badTarget" }));
    const opts = mockRunRetention.mock.calls[0][1];
    expect(opts.only).toEqual(["auditLog"]);
  });

  it("returns 207 when the report has errors", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    mockRunRetention.mockResolvedValueOnce({ ...MOCK_REPORT, hadErrors: true });
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(207);
  });
});

describe("POST /api/admin/cleanup", () => {
  it("returns 403 for unauthenticated callers", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await POST(makeRequest("POST"));
    expect(res.status).toBe(403);
    expect(mockRunRetention).not.toHaveBeenCalled();
  });

  it("defaults to dryRun:true when body is empty", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await POST(makeRequest("POST", { body: {} }));
    expect(mockRunRetention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("passes dryRun:false when explicitly requested", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await POST(makeRequest("POST", { body: { dryRun: false } }));
    expect(mockRunRetention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("passes batchSize from body", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await POST(makeRequest("POST", { body: { batchSize: 250 } }));
    expect(mockRunRetention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchSize: 250 }),
    );
  });

  it("passes only targets from body", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await POST(makeRequest("POST", { body: { only: ["auditLog", "webhookEvent"] } }));
    const opts = mockRunRetention.mock.calls[0][1];
    expect(opts.only).toEqual(["auditLog", "webhookEvent"]);
  });

  it("filters unknown only targets from body", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    await POST(makeRequest("POST", { body: { only: ["auditLog", "unknown"] } }));
    const opts = mockRunRetention.mock.calls[0][1];
    expect(opts.only).toEqual(["auditLog"]);
  });

  it("returns 400 for invalid JSON", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    const url = "http://localhost/api/admin/cleanup";
    const req = new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockRunRetention).not.toHaveBeenCalled();
  });

  it("returns 200 when no errors", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    const res = await POST(makeRequest("POST", { body: {} }));
    expect(res.status).toBe(200);
  });

  it("returns 207 when report has errors", async () => {
    vi.mocked(auth).mockResolvedValueOnce(ADMIN_SESSION as any);
    mockRunRetention.mockResolvedValueOnce({ ...MOCK_REPORT, hadErrors: true });
    const res = await POST(makeRequest("POST", { body: {} }));
    expect(res.status).toBe(207);
  });
});

