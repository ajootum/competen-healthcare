"use client";

import { useEffect, useState } from "react";
import { choosePassword, emailMeALink, signIn } from "../adapters/competen/browser-auth";
import { ApiError, post } from "./client";
import type { Branding } from "./branding";
import { brandStyle } from "./branding";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 8. An invitation link. Signed in, the person accepts. Otherwise they sign in, or create an
// account for the invited address, which proves they control it by email.

export function Invite({ token, organisation, workspace, emailHint, email, signedInEmail, branding }: {
  token: string; organisation: string; workspace: string; emailHint: string; email: string; signedInEmail: string | null; branding: Branding;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- this is the signal that the page's script has started
  useEffect(() => { setReady(true); }, []);

  const accept = async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      if (password && !(await choosePassword(password))) {
        setError("That password could not be set. Try a longer one, or leave it empty.");
        setBusy(false);
        return;
      }
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
        {signedInEmail && matches && (
          <form method="post" onSubmit={e => { e.preventDefault(); void accept(String(new FormData(e.currentTarget).get("password") ?? "")); }}>
            <div className={styles.field}><label htmlFor="lo-inv-new">Choose a password (optional)</label><input id="lo-inv-new" name="password" type="password" minLength={10} autoComplete="new-password" /></div>
            <button className={styles.primary} disabled={busy || !ready}>Accept and open</button>
          </form>
        )}
        {signedInEmail && !matches && <p className={styles.notice}>You are signed in with a different address. Sign out and use the invited one to accept.</p>}
        {!signedInEmail && checkEmail && <p className={styles.notice}>We sent a link to {emailHint}. Open it on this device to continue.</p>}
        {!signedInEmail && !checkEmail && (
          <>
            <button className={styles.primary} disabled={busy || !ready} onClick={async () => {
              setBusy(true);
              setError(null);
              if (await emailMeALink(email, window.location.href)) setCheckEmail(true);
              else setError("That email could not be sent. Try again in a minute.");
              setBusy(false);
            }}>Email me a link</button>
            <p className={styles.muted}>New here, or prefer not to type a password? We email a link to the invited address.</p>
            <form method="post" onSubmit={async e => {
              e.preventDefault();
              const password = String(new FormData(e.currentTarget).get("password"));
              setBusy(true);
              setError(null);
              const r = await signIn(email, password);
              if (r.ok) { window.location.reload(); return; }
              setError("That password did not match. If you are new here, use the email link.");
              setBusy(false);
            }}>
              <div className={styles.field}><label htmlFor="lo-inv-email">Email</label><input id="lo-inv-email" value={email} readOnly autoComplete="email" /></div>
              <div className={styles.field}><label htmlFor="lo-inv-pass">Password, if you already have an account</label><input id="lo-inv-pass" name="password" type="password" required autoComplete="current-password" /></div>
              <button disabled={busy || !ready}>Sign in</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
