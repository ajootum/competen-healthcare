"use client";

import { useEffect, useState } from "react";
import { ApiError, get, post } from "./client";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 9. The person's decision. An app gets nothing until they choose here, and they see exactly
// what it is asking for. Refusing tells the app no, and nothing else.

export type ConsentRequest = {
  clientId: string; redirectUri: string; scope: string; state?: string; codeChallenge: string; codeChallengeMethod: "S256";
};

type Workspace = { id: string; name: string };

export function Consent({ appName, scopes, request }: { appName: string; scopes: { id: string; label: string }[]; request: ConsentRequest }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- this is the signal that the page's script has started
  useEffect(() => { setReady(true); }, []);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    get<Workspace[]>("/workspaces").then(w => {
      setWorkspaces(w);
      // With one workspace there is nothing to choose. With several, the person chooses, and nothing is chosen for them.
      if (w.length === 1) setChosen(w[0].id);
    }).catch(() => { setWorkspaces([]); setError("Your workspaces could not be read just now. Try again."); });
  }, []);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ redirect: string }>("/oauth/authorize", { ...request, workspaceId: chosen });
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
        <fieldset style={{ border: 0, padding: 0, margin: "12px 0" }}>
          <legend style={{ fontWeight: 600, padding: 0 }}>Which workspace can it use?</legend>
          {workspaces === null && <p className={styles.muted} role="status">Loading your workspaces…</p>}
          {workspaces?.map(w => (
            <label key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", minHeight: 44 }}>
              <input type="radio" name="lo-consent-workspace" checked={chosen === w.id} onChange={() => setChosen(w.id)} />
              {w.name}
            </label>
          ))}
        </fieldset>
        <p className={styles.muted}>It sees only records you own in that workspace, and only as far as the list above. Your other workspaces stay out of its reach. You can disconnect it at any time from Connected apps.</p>
        {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy || !ready || !chosen} onClick={allow}>Allow</button>
          <button disabled={busy || !ready} onClick={deny}>Do not allow</button>
        </div>
      </main>
    </div>
  );
}
