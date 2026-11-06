"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, get, patch, post } from "./client";
import type { Lifeos } from "./useLifeos";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 delivery step 8. The organisation's own administration, without code: its name and look, its domains, and
// who is invited. Nothing here can read a member's private records, because no API here returns them.

type Tenant = { id: string; name: string; version: number; branding: { productName?: string; primaryColor?: string; logoUrl?: string } };
type Domain = { id: string; hostname: string; status: string; verificationToken: string; version: number };
type Invitation = { id: string; email: string; role: string; expiresAt: string; version: number };

export function Organisation({ l }: { l: Lifeos }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ws = l.workspaces.find(w => w.id === l.workspaceId);
  const tenantId = ws?.tenantId ?? null;

  const load = useCallback(async () => {
    if (!tenantId || !l.workspaceId) return;
    const [t, d, i] = await Promise.all([
      get<Tenant>(`/tenants/${tenantId}`).catch(() => null),
      get<Domain[]>(`/tenants/${tenantId}/domains`).catch(() => []),
      get<Invitation[]>(`/workspaces/${l.workspaceId}/invitations`).catch(() => []),
    ]);
    setTenant(t); setDomains(d); setInvites(i);
  }, [tenantId, l.workspaceId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the API when the workspace changes
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "That could not be completed."); }
    finally { setBusy(false); }
  };

  if (!tenantId) return <div className={styles.card}>Choose an organisation workspace to see this.</div>;
  return (
    <>
      {error && <div className={styles.alert} role="alert"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>Invite people</h2>
          <form onSubmit={e => {
            e.preventDefault();
            const el = e.currentTarget;
            const f = new FormData(el);
            void run(async () => {
              const r = await post<{ token: string }>(`/workspaces/${l.workspaceId}/invitations`, { email: String(f.get("email")), role: String(f.get("role")) });
              setLink(`${window.location.origin}/lifeos/invite/${r.token}`);
              el.reset();
            });
          }}>
            <div className={styles.field}><label htmlFor="lo-i-email">Email</label><input id="lo-i-email" name="email" type="email" required /></div>
            <div className={styles.field}><label htmlFor="lo-i-role">Role</label><select id="lo-i-role" name="role" defaultValue="member"><option value="member">Member</option><option value="admin">Admin</option></select></div>
            <button className={styles.primary} disabled={busy}>Create invitation</button>
          </form>
          {link && (
            <div className={styles.notice} style={{ marginTop: 12 }}>
              <strong>Send this link to them yourself.</strong> It is shown only once, works once, and lasts 14 days.
              <div style={{ wordBreak: "break-all", marginTop: 6 }} data-testid="invite-link">{link}</div>
            </div>
          )}
          <h3>Waiting ({invites.length})</h3>
          {invites.map(i => (
            <div key={i.id} className={styles.row}>
              <span>{i.email} · {i.role}</span>
              <button disabled={busy} onClick={() => run(() => post(`/workspaces/${l.workspaceId}/invitations/${i.id}/revoke`, { expectedVersion: i.version }))}>Revoke</button>
            </div>
          ))}
          <p className={styles.muted}>Administrators cannot read a member&apos;s private records. A member chooses what to share.</p>
        </div>
        {tenant ? (
          <div>
            <div className={styles.card}>
              <h2>Name and look</h2>
              <form onSubmit={e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const productName = String(f.get("product") ?? "").trim();
                const primaryColor = String(f.get("color") ?? "").trim();
                const logoUrl = String(f.get("logo") ?? "").trim();
                void run(() => patch(`/tenants/${tenant.id}`, {
                  expectedVersion: tenant.version,
                  branding: { ...(productName ? { productName } : {}), ...(primaryColor ? { primaryColor } : {}), ...(logoUrl ? { logoUrl } : {}) },
                }));
              }}>
                <div className={styles.field}><label htmlFor="lo-b-name">Product name</label><input id="lo-b-name" name="product" maxLength={80} defaultValue={tenant.branding.productName ?? ""} /></div>
                <div className={styles.field}><label htmlFor="lo-b-color">Main colour, as #rrggbb</label><input id="lo-b-color" name="color" pattern="#[0-9a-fA-F]{6}" defaultValue={tenant.branding.primaryColor ?? ""} /></div>
                <div className={styles.field}><label htmlFor="lo-b-logo">Logo address</label><input id="lo-b-logo" name="logo" type="url" maxLength={500} defaultValue={tenant.branding.logoUrl ?? ""} /></div>
                <button className={styles.primary} disabled={busy}>Save</button>
              </form>
            </div>
            <div className={styles.card}>
              <h2>Your domain</h2>
              <form onSubmit={e => {
                e.preventDefault();
                const el = e.currentTarget;
                const hostname = String(new FormData(el).get("hostname"));
                void run(async () => { await post(`/tenants/${tenant.id}/domains`, { hostname }); el.reset(); });
              }}>
                <div className={styles.field}><label htmlFor="lo-d-host">Hostname</label><input id="lo-d-host" name="hostname" required placeholder="plan.example.org" /></div>
                <button disabled={busy}>Add domain</button>
              </form>
              {domains.map(d => (
                <div key={d.id} className={styles.task}>
                  <div className={styles.row}><strong>{d.hostname}</strong><span className={styles.tag}>{d.status === "verified" ? "Verified" : "Not verified yet"}</span></div>
                  {d.status !== "verified" && (
                    <p className={styles.muted} style={{ wordBreak: "break-all" }}>
                      Add a TXT record named <code>_lifeos-verify.{d.hostname}</code> with the value <code>{d.verificationToken}</code>, then check it.
                    </p>
                  )}
                  <div className={styles.actions}>
                    {d.status !== "verified" && <button disabled={busy} onClick={() => run(() => post(`/tenants/${tenant.id}/domains/${d.id}/verify`, { expectedVersion: d.version }))}>Check now</button>}
                    <button disabled={busy} onClick={() => run(() => post(`/tenants/${tenant.id}/domains/${d.id}/remove`, { expectedVersion: d.version }))}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.card}>Only the organisation&apos;s accountable owner can change its name, look and domains.</div>
        )}
      </div>
    </>
  );
}
