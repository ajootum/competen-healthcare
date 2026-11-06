"use client";

import { useEffect, useState } from "react";
import { ApiError, downloadExport, get, post } from "./client";
import { ConnectedAppsCard } from "./ConnectedApps";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 6. A signed-in person without LifeOS. If they are eligible, they may choose to turn it on.
// Nothing here turns anything on without that choice.

type Status = { enabled: boolean; eligible: boolean; active: boolean; hasRecords: boolean; terms: { version: string; title: string; url: string } | null };

export function ActivateAccess() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Status>("/access/status").then(setStatus, () => setFailed(true));
  }, []);

  const activate = async () => {
    if (!status?.terms) return;
    setBusy(true);
    setError(null);
    try {
      await post("/access/competen-individual", { termsVersion: status.terms.version });
      window.location.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be completed.");
      setBusy(false);
    }
  };

  const canOffer = status?.eligible && status.terms && !status.active;
  return (
    <div className={styles.root} style={{ display: "grid", placeItems: "center", padding: 16 }}>
      <main className={styles.card} style={{ width: "min(520px, 100%)" }}>
        <div className={styles.eyebrow}>Competen LifeOS</div>
        {!canOffer && (
          <>
            <h1 style={{ fontSize: 24, margin: "6px 0" }}>LifeOS is not enabled for this account</h1>
            {status === null && !failed
              ? <p className={styles.muted} role="status">Checking…</p>
              : <p>This account does not currently hold LifeOS access. Ask the person who invited you to check it.</p>}
            {status !== null && status.hasRecords && (
              <p>Your records are kept. <button onClick={() => { downloadExport().catch(() => setError("Your records could not be prepared just now.")); }}>Download my records</button></p>
            )}
            {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
            {status !== null && status.hasRecords && <ConnectedAppsCard />}
          </>
        )}
        {canOffer && status.terms && (
          <>
            <h1 style={{ fontSize: 24, margin: "6px 0" }}>Turn on LifeOS</h1>
            <p>LifeOS is an optional personal planner for your commitments, included with your Competen account.</p>
            <ul style={{ paddingLeft: 18, fontSize: 14 }}>
              <li>What you keep in LifeOS stays private to you unless you share it.</li>
              <li>Your other Competen products cannot read it, and LifeOS does not read them. LifeOS only checks that your account is active.</li>
              <li>You can turn it off at any time.</li>
            </ul>
            <label className={styles.check}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>I accept the <a href={status.terms.url} target="_blank" rel="noreferrer">{status.terms.title}</a></span>
            </label>
            {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
            <button className={styles.primary} disabled={!agreed || busy} onClick={activate}>Turn on LifeOS</button>
          </>
        )}
      </main>
    </div>
  );
}
