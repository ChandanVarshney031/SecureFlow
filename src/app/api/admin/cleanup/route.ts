/**
 * POST /api/admin/cleanup
 *
 * Trigger a data-retention purge (or dry-run preview) from within the
 * application.  This is the **single** HTTP surface for the retention engine;
 * all admin tooling (UI, cron, CLI proxy) should call this route.
 *
 * Authentication: ADMIN session **or** a bearer token matching CLEANUP_SECRET,
 * CRON_SECRET, or AUTH_SECRET.  The same check applies to both GET and POST so
 * the caller never needs to care which verb it uses for a simple status check.
 *
 * GET  → dry-run preview (read-only, safe to call repeatedly)
 * POST → body { dryRun?: boolean; batchSize?: number; only?: string[] }
 *        dryRun defaults to true so a bare POST is still safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { runRetention, type PurgeOptions } from "@/lib/retention/purge";
import type { PurgeTarget } from "@/lib/retention/policy";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Bearer-token secrets that may authorise automated callers. */
const ALLOWED_SECRETS = (): string[] =>
  [
    process.env.CLEANUP_SECRET,
    process.env.CRON_SECRET,
    process.env.AUTH_SECRET,
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

/** Extract `Bearer <token>` from the Authorization header. */
function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/**
 * Returns true when the caller is allowed to trigger cleanup.
 * Accepts an ADMIN session **or** a recognised bearer token.
 */
async function isAuthorised(req: NextRequest): Promise<boolean> {
  // 1. Valid ADMIN session
  const session = await auth();
  if (session?.user?.roles?.includes("ADMIN")) return true;

  // 2. Bearer token
  const token = extractBearer(req);
  if (token) {
    const secrets = ALLOWED_SECRETS();
    if (secrets.includes(token)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Shared handler
// ---------------------------------------------------------------------------

const VALID_TARGETS = new Set<PurgeTarget>([
  "auditLog",
  "webhookEvent",
  "scanResult",
  "findingSnippet",
]);

async function handleCleanup(options: PurgeOptions) {
  const report = await runRetention(prisma as any, options);
  return NextResponse.json(report, { status: report.hadErrors ? 207 : 200 });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** GET → dry-run preview; never deletes anything. */
export async function GET(req: NextRequest) {
  if (!(await isAuthorised(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const batchSize = sp.has("batchSize") ? Number(sp.get("batchSize")) : undefined;
  const only = sp.has("only")
    ? (sp.get("only")!.split(",").filter((t) => VALID_TARGETS.has(t as PurgeTarget)) as PurgeTarget[])
    : undefined;

  return handleCleanup({ dryRun: true, batchSize, only });
}

/** POST → configurable; dryRun defaults to true for safety. */
export async function POST(req: NextRequest) {
  if (!(await isAuthorised(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dryRun = body.dryRun === false ? false : true; // safe default
  const batchSize =
    typeof body.batchSize === "number" && Number.isInteger(body.batchSize) && body.batchSize > 0
      ? body.batchSize
      : undefined;
  const only = Array.isArray(body.only)
    ? (body.only.filter((t) => VALID_TARGETS.has(t as PurgeTarget)) as PurgeTarget[])
    : undefined;

  return handleCleanup({ dryRun, batchSize, only });
}

