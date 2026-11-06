"use client";

import { useEffect, useState } from "react";
import { ApiError, post } from "./client";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 9. The person's decision. An app gets nothing until they choose here, and they see exactly
// what it is asking for. Refusing tells the app no, and nothing else.

export type ConsentRequest = {
  clientId: string; redirectUri: string; scope: string; state?: string; codeChallenge: string; codeChallengeMethod: "S256";
};

export function Consent({ appName, scopes, request }: { appName: string; scopes: { id: string; label: string }[]; request: ConsentRequest }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- this is the signal that the page's script has started
  useEffect(() => { setReady(true); }, []);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ redirect: string }>("/oauth/authorize", request);
      window.location.href = r.redirect;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be completed.");
      setBusy(false);
    }
  };
  const deny = () => {
    const u = new URL(request.redirectUri);
    u.searchParams.set("error", "access_denied");
    if (request.state) u.searchParams.set("state", request.state);
    window.location.href = u.toString();
  };

  return (
    <div className={styles.root} style={{ display: "grid", placeItems: "center", padding: 16 }}>
      <main className={styles.card} style={{ width: "min(480px, 100%)" }}>
        <div className={styles.eyebrow}>Competen LifeOS</div>
        <h1 style={{ fontSize: 24, margin: "6px 0" }}>{appName} wants to connect</h1>
        <p>If you allow this, {appName} can:</p>
        <ul style={{ paddingLeft: 18, fontSize: 14 }}>
          {scopes.map(s => <li key={s.id}>{s.label}</li>)}
        </ul>
        <p className={styles.muted}>It acts only within records you can already reach, and only as far as the list above. You can disconnect it at any time from Connected apps.</p>
        {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy || !ready} onClick={allow}>Allow</button>
          <button disabled={busy || !ready} onClick={deny}>Do not allow</button>
        </div>
      </main>
    </div>
  );
}
