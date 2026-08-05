import { NextRequest } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { eventsSince, markPublished, advance, STREAM_BATCH } from "@/lib/practice/event-stream";

// GET /api/v1/practice/stream -- CPR-CORE-001 s10's `GET /practice/stream`, the second half of CORE-09.
//
// "SSE/WebSocket stream of dashboard-relevant events." Server-Sent Events rather than a WebSocket: the
// traffic is one-directional (the server tells the dashboard something changed, the dashboard never
// tells the server anything back through this channel), SSE reconnects and replays by itself through
// Last-Event-ID, and it is plain HTTP -- which matters on the clinic connectivity s18 asks about, where
// a proxy that mangles WebSocket upgrades is a real thing and an unexplainable one.
//
// ── IT IS A TAIL, AND IT SAYS SO ────────────────────────────────────────────────────────────────────
//
// There is no broker here. This polls the outbox every POLL_MS and pushes what it finds, so an event
// reaches a screen within about two seconds rather than instantly. That is still a push as far as the
// client is concerned -- no request, no refresh -- and it is the honest shape given the storage. The
// alternative, LISTEN/NOTIFY, needs a dedicated connection per subscriber and PostgREST does not expose
// one; saying "real time" over a two-second poll would be a claim nobody could check.
//
// ── WHAT IT SENDS ───────────────────────────────────────────────────────────────────────────────────
//
//   event: practice          one dashboard-relevant domain event, `id:` set so the browser can resume
//   event: ready             sent once on connect, so a client can tell "connected" from "quiet"
//   :heartbeat               an SSE comment every HEARTBEAT_MS, which no client sees and every proxy does
//
// ⚠ THE HEARTBEAT IS NOT DECORATION. Proxies and load balancers close idle connections at somewhere
// between 30 and 60 seconds, and a dashboard whose stream silently died looks exactly like a dashboard
// on a quiet morning. The comment line keeps the socket warm and costs one byte per interval.

export const dynamic = "force-dynamic";

const POLL_MS = 2000;
const HEARTBEAT_MS = 25_000;
/** A connection is closed after this long so a forgotten tab cannot poll the outbox forever. The client
 *  reconnects automatically -- SSE does that unasked -- and resumes from its own Last-Event-ID. */
const MAX_CONNECTION_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const { admin } = auth.caller;
  const ctx = auth.ctx;

  // WHERE TO RESUME. `Last-Event-ID` is the browser's own header, sent unprompted after a drop, and
  // `?since=` is the same thing for a caller that is not a browser. Absent both, the stream starts at
  // NOW: a client connecting for the first time wants what happens next, not this morning's history.
  const lastId = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("since");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); }
        // The client went away between the poll and the write. Not an error, and not worth a log line.
        catch { closed = true; }
      };

      // Resolve the resume point. An id we cannot find is treated as "start from now" rather than
      // replaying everything: a stale id from a previous deployment must not dump a week into a browser.
      let cursor: { recordedAt: string; id: string } | null = null;
      if (lastId) {
        const { data } = await admin.from("practice_domain_event")
          .select("id, recorded_at").eq("id", lastId).eq("workspace_id", ctx.workspaceId).maybeSingle();
        if (data) cursor = { recordedAt: data.recorded_at, id: data.id };
      }
      if (!cursor) {
        const { data } = await admin.from("practice_domain_event")
          .select("id, recorded_at").eq("workspace_id", ctx.workspaceId)
          .order("recorded_at", { ascending: false }).order("id", { ascending: false })
          .limit(1).maybeSingle();
        cursor = data ? { recordedAt: data.recorded_at, id: data.id } : null;
      }

      send(`event: ready\ndata: ${JSON.stringify({ resumed: !!lastId, correlationId: auth.caller.traceId })}\n\n`);

      const startedAt = Date.now();
      let lastBeat = Date.now();

      while (!closed && !req.signal.aborted && Date.now() - startedAt < MAX_CONNECTION_MS) {
        const { events, error } = await eventsSince(admin, ctx, cursor);

        if (error) {
          // TOLD, NOT HIDDEN. A stream that swallows a read failure leaves the dashboard looking live and
          // being stale, which is the one state s16 says the page must never imply.
          send(`event: degraded\ndata: ${JSON.stringify({ message: "the event log could not be read" })}\n\n`);
        } else if (events.length > 0) {
          for (const e of events) {
            send(`id: ${e.id}\nevent: practice\ndata: ${JSON.stringify(e)}\n\n`);
          }
          cursor = advance(events, cursor);
          // AFTER the write to the client, never before: published_at means "reached a live stream", and
          // stamping it first would claim delivery for events a dropped socket never carried.
          await markPublished(admin, events.map(e => e.id));

          // A full batch means there is more waiting. Poll again immediately rather than sleeping, or a
          // morning's backlog would drain at 200 events every two seconds.
          if (events.length === STREAM_BATCH) continue;
        }

        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          send(`:heartbeat\n\n`);
          lastBeat = Date.now();
        }
        await new Promise(r => setTimeout(r, POLL_MS));
      }

      if (!closed) {
        // Say goodbye, so a client can tell a deliberate close from a dropped connection.
        send(`event: bye\ndata: ${JSON.stringify({ reason: "connection age limit" })}\n\n`);
        try { controller.close(); } catch { /* already closed by the client */ }
      }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // No caching, ever. A cached event stream is a dashboard that reports yesterday with confidence.
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers responses by default, which holds every event until the connection closes -- the
      // stream would deliver a whole morning at once, in the evening.
      "x-accel-buffering": "no",
    },
  });
}
