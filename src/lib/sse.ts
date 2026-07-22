// Server-Sent Events helper (POS-001J Real-Time Event Bus). Turns a payload
// producer into a text/event-stream Response: pushes immediately on connect,
// then on an interval, plus a heartbeat comment to defeat idle proxies. Closes
// cleanly when the client disconnects (req.signal aborts). Server-driven cadence
// today; the persistent connection is the substrate for true event-triggered
// pushes later. Auth is the caller's responsibility (gate before calling).
/* eslint-disable @typescript-eslint/no-explicit-any */

export function sseStream(opts: { signal: AbortSignal; intervalMs: number; produce: () => Promise<any> }): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => { if (!closed) { try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; } } };
      const push = async () => {
        try { enqueue(`data: ${JSON.stringify(await opts.produce())}\n\n`); }
        catch { enqueue(`: error\n\n`); } // keep the stream open; retry next tick
      };
      const close = () => {
        if (closed) return; closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };

      if (opts.signal.aborted) return close();
      opts.signal.addEventListener("abort", close);

      enqueue(`retry: 5000\n\n`); // client reconnect backoff
      await push();
      timer = setInterval(push, opts.intervalMs);
    },
    cancel() { if (timer) clearInterval(timer); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
