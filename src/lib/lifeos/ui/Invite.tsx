"use client";

import { useEffect, useState } from "react";
import { signIn, signUp } from "../adapters/competen/browser-auth";
import { ApiError, post } from "./client";
import type { Branding } from "./branding";
import { brandStyle } from "./branding";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 8. An invitation link. Signed in, the person accepts. Otherwise they sign in, or create an
// account for the invited address, which proves they control it by email.

export function Invite({ token, organisation, workspace, emailHint, email, signedInEmail, branding }: {
  token: string; organisation: string; workspace: string; emailHint: string; email: string; signedInEmail: string | null; branding: Branding;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- this is the signal that the page's script has started
  useEffect(() => { setReady(true); }, []);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await post("/access/invitation", { token });
      window.location.href = "/lifeos";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be completed.");
      setBusy(false);
    }
  };

  const matches = signedInEmail?.toLowerCase() === email;
  return (
    <div className={styles.root} style={{ display: "grid", placeItems: "center", padding: 16, ...brandStyle(branding) }}>
      <main className={styles.card} style={{ width: "min(460px, 100%)" }}>
        {branding.logoUrl && <img src={branding.logoUrl} alt="" style={{ maxHeight: 48, maxWidth: "100%", marginBottom: 12 }} />}
        <div className={styles.eyebrow}>{organisation}</div>
        <h1 style={{ fontSize: 24, margin: "6px 0" }}>You are invited to {branding.productName ?? "LifeOS"}</h1>
        <p>{organisation} has invited {emailHint} to join {workspace}.</p>
        <ul style={{ paddingLeft: 18, fontSize: 14 }}>
          <li>Your organisation cannot read what you keep private, including its administrators.</li>
          <li>You also get a personal workspace, which stays yours if you leave.</li>
        </ul>
        {error && <div className={styles.alert} role="alert"><span>{error}</span></div>}
        {signedInEmail && matches && <button className={styles.primary} disabled={busy || !ready} onClick={accept}>Accept and open</button>}
        {signedInEmail && !matches && <p className={styles.notice}>You are signed in with a different address. Sign out and use the invited one to accept.</p>}
        {!signedInEmail && checkEmail && <p className={styles.notice}>Check your email and confirm your address, then open this link again.</p>}
        {!signedInEmail && !checkEmail && (
          <form method="post" onSubmit={async e => {
            e.preventDefault();
            const password = String(new FormData(e.currentTarget).get("password"));
            setBusy(true);
            setError(null);
            if (mode === "signin") {
              const r = await signIn(email, password);
              if (r.ok) { window.location.reload(); return; }
              setError("That password did not match. If you are new here, choose Create an account.");
            } else {
              const r = await signUp(email, password, window.location.href);
              if (r.kind === "signed_in") { window.location.reload(); return; }
              if (r.kind === "check_email") setCheckEmail(true);
              else setError("That account could not be created. If you already have one, choose Sign in.");
            }
            setBusy(false);
          }}>
            <div className={styles.field}><label htmlFor="lo-inv-email">Email</label><input id="lo-inv-email" value={email} readOnly autoComplete="email" /></div>
            <div className={styles.field}><label htmlFor="lo-inv-pass">{mode === "signin" ? "Password" : "Choose a password"}</label><input id="lo-inv-pass" name="password" type="password" required minLength={mode === "signup" ? 10 : 1} autoComplete={mode === "signin" ? "current-password" : "new-password"} /></div>
            <div className={styles.actions}>
              <button className={styles.primary} disabled={busy || !ready}>{mode === "signin" ? "Sign in" : "Create account"}</button>
              <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>{mode === "signin" ? "Create an account" : "I already have an account"}</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
