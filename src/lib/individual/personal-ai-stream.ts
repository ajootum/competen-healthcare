import { later, stageTimer } from "./scholar/learn-flight";
import { NDJSON_TYPE, type PersonalAiTiming, type StreamEvent } from "./personal-ai-options";

// ── SCHOLAR-PAI-EXPERIENCE-01: A PERSONAL AI ANSWER, STREAMED ONLY AFTER EVERY GATE ──────────────────────────────
//
// THE RESPONSE KIND IS DECIDED BY THE FIRST ANSWER TEXT, NOT BY THE REQUEST. The route starts the one Personal AI
// pipeline (runIndividualAssistant -> runPersonalAssistant -> runMeteredAi -> generate) and waits for whichever comes
// first: the pipeline's outcome, or the first piece of answer text. Text exists only once generate() is running, and
// generate() is reached only after the guard, the quota, the identifier screen, the clinical risk decision (clarify,
// restricted), eligibility, routing and the reservation. So:
//   - every refusal, clarify question (409), restricted request (422), invalid input and generation failure that
//     happens before text is the SAME JSON response the route always sent;
//   - only an answer that is actually being written is sent as NDJSON (delta events, then one done or error event).
//
// NOTHING ABOUT METERING CHANGES. The pipeline runs to its end whatever the browser does: settle with the provider's
// actual usage, or release / mark unreconciled exactly as the buffered path does on a failure (allowance.ts meter).
// A browser that goes away only stops the forwarding; the generation, its settlement, plat_ai_requests and the audit
// row still complete, held open with Next `after` (learn-flight later). No reservation is left behind by a disconnect.
//
// A FAILURE AFTER TEXT (a provider refusal mid-answer, a broken stream) ends with an error event, and the browser
// discards the partial text: it is never shown as an answer (personal-ai-options.ts readPersonalAi).

export type LiveHooks = { onText: (text: string) => void; onStart: () => void; onStage: (stage: "gate" | "context") => void };

/**
 * One request's stage timings and its text hand-off. Created at the top of the route (the gate starts there); `want`
 * says, once the body is read, whether the browser asked for a stream (default: no, the JSON as always).
 */
export function personalAiFlight(now?: () => number) {
  const timer = stageTimer(now);
  let streaming = false;
  let ttft: number | null = null;
  let sink: ((t: string) => void) | null = null;
  const early: string[] = [];
  let first!: () => void;
  const started = new Promise<void>(r => { first = r; });
  const hooks: LiveHooks = {
    onStage: stage => timer.mark(stage),
    // The provider is about to be asked: everything since compose (risk, eligibility, routing, reservation) is gate.
    onStart: () => timer.mark("gate"),
    onText: text => {
      if (!text) return;
      if (ttft === null) { ttft = timer.snapshot().total; first(); }
      if (!streaming) return;
      if (sink) sink(text); else early.push(text);
    },
  };
  return {
    get streaming() { return streaming; },
    want(on: boolean) { streaming = on; },
    /** For the audit row: the answer was actually sent as a stream (asked for, and text was written). */
    get streamed() { return streaming && ttft !== null; },
    hooks, started,
    timing(): PersonalAiTiming { const s = timer.snapshot(); return { gate: s.gate ?? 0, context: s.context ?? 0, ttft, total: s.total }; },
    attach(fn: (t: string) => void) { for (const t of early.splice(0)) fn(t); sink = fn; },
  };
}
export type PersonalAiFlight = ReturnType<typeof personalAiFlight>;

const FAILED = "The assistant could not answer just now. Try again shortly.";

/**
 * The route's response. `json` is what the route answered before streaming, for an outcome reached before any text
 * (or when the browser did not ask for a stream). `finish` runs once after a streamed answer ends -- its audit row --
 * and returns the closing event.
 */
export async function personalAiResponse<T>(flight: PersonalAiFlight, run: () => Promise<T>,
  handlers: { json: (out: T) => Promise<Response> | Response; finish: (out: T) => Promise<StreamEvent> }): Promise<Response> {
  const pipeline = run();
  if (!flight.streaming) return handlers.json(await pipeline);
  const first = await Promise.race([flight.started.then(() => null), pipeline.then(out => ({ out }))]);
  if (first) return handlers.json(first.out);

  const enc = new TextEncoder();
  let open = true;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const send = (e: StreamEvent) => {
    if (!open || !controller) return;
    try { controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { open = false; }
  };
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; flight.attach(text => send({ type: "delta", text })); },
    // The browser went away: stop forwarding. The pipeline below still settles and audits.
    cancel() { open = false; },
  });
  const tail = pipeline.then(handlers.finish, () => ({ type: "error", code: "failed", message: FAILED }) as StreamEvent)
    .catch(() => ({ type: "error", code: "failed", message: FAILED }) as StreamEvent)
    .then(e => { send(e); if (open) { open = false; try { controller?.close(); } catch { /* already closed */ } } });
  later(() => tail);
  return new Response(body, { headers: { "Content-Type": `${NDJSON_TYPE}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
