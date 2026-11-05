"use client";

// SALE-2026-11 R2 / SALE-10: "Try it in a new setting" -- starts a transfer check on one topic. The server (api/individual/scholar/transfer)
// chooses the questions from outside the lesson with no AI where it can. Where it cannot, this asks the EXISTING revision sessions route
// to write one (the same gate, allowance and model routing as any revision question), then records that session as the transfer check.
// Nothing starts until the learner clicks. Formative only.

import { useState } from "react";
import { learnAction } from "@/components/ui/scholar-learning";


async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "You seem to be offline. Try again when you are connected." } }; }
}

export function TransferOffer({ topic }: { topic: string }) {
  const [busy, setBusy] = useState<null | "choosing" | "writing">(null);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy("choosing"); setError(null);
    const offer = await post("/api/individual/scholar/transfer", { action: "offer", topic });
    if (offer.ok && typeof offer.json.href === "string") { window.location.assign(offer.json.href); return; }
    if (offer.ok && offer.json.generate && typeof offer.json.generate === "object") {
      setBusy("writing");
      const made = await post("/api/individual/scholar/revision/sessions", offer.json.generate);
      const id = (made.json.session as { id?: unknown } | undefined)?.id;
      if (!made.ok || typeof id !== "string") { setBusy(null); setError(typeof made.json.error === "string" ? made.json.error : "A new question could not be written just now."); return; }
      const rec = await post("/api/individual/scholar/transfer", { action: "record", topic, sessionId: id });
      if (rec.ok && typeof rec.json.href === "string") { window.location.assign(rec.json.href); return; }
      setBusy(null); setError(typeof rec.json.error === "string" ? rec.json.error : "The transfer check could not be recorded just now.");
      return;
    }
    setBusy(null); setError(typeof offer.json.error === "string" ? offer.json.error : "The transfer check could not be started just now.");
  }
  return (
    <div className="mt-1.5">
      <button type="button" onClick={start} disabled={busy !== null} data-transfer-start={topic}
        className={learnAction.primary}>
        {busy === "choosing" ? "Choosing a question…" : busy === "writing" ? "Writing a new question…" : "Try it in a new setting"}
      </button>
      {error && <p role="alert" className="mt-1.5 text-[13px] text-red-800">{error}</p>}
    </div>
  );
}
