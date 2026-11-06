"use client";

import { useEffect, useState } from "react";
import { signIn } from "../adapters/competen/browser-auth";
import type { Branding } from "./branding";
import { brandStyle } from "./branding";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 7. Sign-in on a tenant's own domain, under its own name, so the person never leaves it.

export function SignIn({ branding, name }: { branding: Branding; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Until the script is running, a browser would submit this form itself and put the password in the address. A disabled
  // submit button stops that, including for the Enter key.
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- this is the signal that the page's script has started
  useEffect(() => { setReady(true); }, []);
  return (
    <div className={styles.root} style={{ display: "grid", placeItems: "center", padding: 16, ...brandStyle(branding) }}>
      <main className={styles.card} style={{ width: "min(420px, 100%)" }}>
        {branding.logoUrl && <img src={branding.logoUrl} alt="" style={{ maxHeight: 48, maxWidth: "100%", marginBottom: 12 }} />}
        <div className={styles.eyebrow}>{name}</div>
        <h1 style={{ fontSize: 24, margin: "6px 0 14px" }}>Sign in to {branding.productName ?? "LifeOS"}</h1>
        <form method="post" onSubmit={async e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError(null);
          const r = await signIn(String(f.get("email")), String(f.get("password")));
          if (r.ok) { window.location.reload(); return; }
          setError("That email and password did not match.");
          setBusy(false);
        }}>
          <div className={styles.field}><label htmlFor="lo-email">Email</label><input id="lo-email" name="email" type="email" required autoComplete="email" /></div>
          <div className={styles.field}><label htmlFor="lo-pass">Password</label><input id="lo-pass" name="password" type="password" required autoComplete="current-password" /></div>
          {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
          <button className={styles.primary} disabled={busy || !ready}>Sign in</button>
        </form>
      </main>
    </div>
  );
}
