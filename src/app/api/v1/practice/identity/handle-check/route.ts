import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { checkHandle } from "@/lib/practice/identity-service";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// GET /api/v1/practice/identity/handle-check?handle=... -- PIS-000 s3's availability check.
//
// ⚠ THIS ENDPOINT IS AN ENUMERATION ORACLE AND THE FILE SAYS SO RATHER THAN PRETENDING OTHERWISE.
//
// Anybody who can call it can sweep the handle namespace and learn which names exist. Three to thirty
// lowercase alphanumerics is a small space and the URLs are public by design, so secrecy was never the
// control -- migration 254 makes the same argument about /@handle. What bounds the disclosure is that
// the answer is ONE BIT:
//
//   - checkHandle() collapses taken, reserved and retired into a single `unavailable`. Which of the
//     three it is would tell a sweeper whether a real practitioner holds the name, and that is a fact
//     about a person rather than about a string.
//   - Nothing here returns a name, a practice, an identity id, a user id or a reason.
//   - The caller must be an authenticated member of a practice holding practice.settings.manage. A
//     sweeper therefore has an account and a trail, which is the difference between a nuisance and an
//     anonymous scrape.
//
// ⚠ THE RATE LIMIT IS PER PROCESS AND BEST-EFFORT, AND THAT IS STATED RATHER THAN DRESSED UP. It is an
// in-memory counter: a deployment running several instances gives each its own allowance, and a restart
// forgets everything. It is here because a typing UI should not be able to walk the alphabet, not
// because it is a security boundary -- the honest boundary is the authentication above.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000;
/** Enough for a person typing and rethinking; far too few to walk a namespace. */
const MAX_PER_WINDOW = 40;

const recent = new Map<string, number[]>();

function overLimit(userId: string): boolean {
  const now = Date.now();
  const kept = (recent.get(userId) ?? []).filter(t => now - t < WINDOW_MS);
  if (kept.length >= MAX_PER_WINDOW) {
    recent.set(userId, kept);
    return true;
  }
  kept.push(now);
  recent.set(userId, kept);
  // Keep the map from growing without bound in a long-lived process.
  if (recent.size > 5_000) {
    for (const [k, v] of recent) if (v.every(t => now - t >= WINDOW_MS)) recent.delete(k);
  }
  return false;
}

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  if (overLimit(ctx.userId))
    return NextResponse.json({
      error: {
        code: "TOO_MANY_CHECKS",
        message: `you can check ${MAX_PER_WINDOW} handles a minute. Wait a moment and try again.`,
      },
    }, { status: 429 });

  const raw = req.nextUrl.searchParams.get("handle") ?? "";
  const check = await checkHandle(caller.admin, raw);

  // ⚠ 200 FOR EVERY ANSWER INCLUDING `unreadable`. A 500 on a failed read would be a different shape of
  // response for a different shape of failure, which is itself a signal; and the screen has to be able
  // to say "that could not be checked" rather than showing a green tick or a red cross it cannot justify.
  return NextResponse.json({ ...check, correlationId: caller.traceId });
}
