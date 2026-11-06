"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, get, post } from "./client";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 9. What a person has connected, and the way to end it.

type App = { id: string; appName: string; scopes: string[]; connectedAt: string };

export function ConnectedApps() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setApps(await get<App[]>("/me/connected-apps")); }
    catch (e) { setError(e instanceof ApiError ? e.message : "These could not be read just now."); setApps([]); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the API after mount
  useEffect(() => { void load(); }, [load]);
  return (
    <div className={styles.card}>
      <h2>Connected apps</h2>
      <p className={styles.muted}>Apps you have allowed to act for you. Disconnecting one ends its access at once.</p>
      {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
      {apps === null && <p role="status">Loading…</p>}
      {apps?.length === 0 && !error && <p>No apps are connected.</p>}
      {apps?.map(a => (
        <div key={a.id} className={styles.task}>
          <strong>{a.appName}</strong>
          <div className={styles.muted}>{a.scopes.join(", ")}</div>
          <div className={styles.actions}>
            <button onClick={async () => {
              try { await post(`/me/connected-apps/${a.id}/disconnect`, {}); await load(); }
              catch (e) { setError(e instanceof ApiError ? e.message : "That could not be completed."); }
            }}>Disconnect</button>
          </div>
        </div>
      ))}
    </div>
  );
}
