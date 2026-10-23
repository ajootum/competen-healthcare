"use client";

import { useState } from "react";
import { primaryBtn } from "./chrome";

// Accepting a Competen Individual invitation (COMPETEN-IND-ACCESS-001, migration 378). It sends nothing but
// the request: the server finds the invitation by the signed-in identity, and refuses anything else.

export default function AcceptInvitation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/invitation/accept", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "The invitation could not be accepted."); return; }
      window.location.assign(json.next ?? "/individual/home");
    } catch {
      setError("The invitation could not be accepted. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={accept} disabled={busy} className={`${primaryBtn} bg-gray-900 disabled:opacity-50`}>
        {busy ? "Accepting…" : "Accept invitation"}
      </button>
      {error && <p role="alert" className="basis-full text-[13.5px] font-medium text-red-700">{error}</p>}
    </>
  );
}
