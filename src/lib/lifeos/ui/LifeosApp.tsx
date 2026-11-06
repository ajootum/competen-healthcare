"use client";

import { useEffect, useMemo, useState } from "react";
import type { Commitment, World } from "./client";
import { addDays } from "../core/time";
import {
  CaptureScreen, Calendar, ChiefOfStaff, Commitments, Plan, Quadrants, Review, SCREENS, Today, Worlds,
  type Actions,
} from "./screens";
import { NAV, isScreen, type Screen } from "./nav";
import { type CommitmentFields, type Lifeos, useLifeos } from "./useLifeos";
import { useModalFocus } from "./useModalFocus";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 step 5. The shell of the owner-approved baseline: sidebar, bottom bar, Capture, and the dialogs.

const BOTTOM: Screen[] = ["calendar", "today", "capture", "commitments"];
const MORE: Screen[] = ["plan", "worlds", "quadrants", "review", "ai"];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useModalFocus<HTMLDivElement>(onClose);
  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const boolToSelect = (v: boolean | null | undefined) => (v === true ? "1" : v === false ? "0" : "");
const selectToBool = (v: FormDataEntryValue | null) => (v === "1" ? true : v === "0" ? false : null);

function fieldsFrom(form: FormData): CommitmentFields {
  const mins = Number(form.get("minutes"));
  return {
    title: String(form.get("title") ?? "").trim(),
    worldId: String(form.get("world") ?? "") || null,
    important: selectToBool(form.get("important")),
    urgent: selectToBool(form.get("urgent")),
    scheduledOn: String(form.get("date") ?? "") || null,
    scheduledTime: String(form.get("time") ?? "") || null,
    estimatedMinutes: Number.isFinite(mins) && mins > 0 ? mins : null,
  };
}

function CommitmentForm({ l, c, preset, rock, protect, onDone, submitLabel }: {
  l: Lifeos; c?: Commitment; preset?: { date?: string; worldId?: string }; rock?: boolean; protect?: boolean; onDone?: () => void; submitLabel: string;
}) {
  const worldDefault = c ? (c.worldId ?? "") : (preset?.worldId ?? l.data.worlds[0]?.id ?? "");
  return (
    <form onSubmit={async e => {
      e.preventDefault();
      const el = e.currentTarget;
      const form = new FormData(el);
      const f = fieldsFrom(form);
      const ok = c
        ? await l.saveCommitment(c, f, form.has("rock"), form.has("protected"))
        : await l.capture(f);
      if (ok) { if (!c) el.reset(); onDone?.(); }
    }}>
      <div className={styles.field}><label htmlFor="lo-title">Commitment</label><input id="lo-title" name="title" required maxLength={500} defaultValue={c?.title} placeholder="What needs attention?" /></div>
      <div className={styles.field}>
        <label htmlFor="lo-world">Role / world</label>
        <select id="lo-world" name="world" defaultValue={worldDefault}>
          <option value="">Decide later</option>
          {l.data.worlds.map(w => <option key={w.id} value={w.id}>{w.title}{w.context ? ` · ${w.context}` : ""}</option>)}
        </select>
      </div>
      <div className={styles.twoFields}>
        <div className={styles.field}><label htmlFor="lo-imp">Importance</label>
          <select id="lo-imp" name="important" defaultValue={c ? boolToSelect(c.important) : "1"}><option value="1">Important</option><option value="0">Not important</option><option value="">Decide later</option></select></div>
        <div className={styles.field}><label htmlFor="lo-urg">Urgency</label>
          <select id="lo-urg" name="urgent" defaultValue={c ? boolToSelect(c.urgent) : "0"}><option value="0">Not urgent</option><option value="1">Urgent</option><option value="">Decide later</option></select></div>
      </div>
      <div className={styles.twoFields}>
        <div className={styles.field}><label htmlFor="lo-date">Date (optional)</label><input id="lo-date" type="date" name="date" defaultValue={c?.scheduledOn ?? preset?.date ?? ""} /></div>
        <div className={styles.field}><label htmlFor="lo-time">Time</label><input id="lo-time" type="time" name="time" defaultValue={c?.scheduledTime?.slice(0, 5) ?? ""} /></div>
      </div>
      <div className={styles.field}><label htmlFor="lo-min">Estimated minutes</label><input id="lo-min" type="number" name="minutes" min={5} max={1440} defaultValue={c?.estimatedMinutes ?? 30} /></div>
      {c && <label className={styles.check}><input type="checkbox" name="rock" defaultChecked={rock} /> Weekly Big Rock</label>}
      {c && <label className={styles.check}><input type="checkbox" name="protected" defaultChecked={protect} /> Protect this time</label>}
      <button className={styles.primary} disabled={l.busy}>{submitLabel}</button>
    </form>
  );
}

type Dialog =
  | { kind: "capture"; preset?: { date?: string; worldId?: string } }
  | { kind: "edit"; c: Commitment }
  | { kind: "delegate"; c: Commitment }
  | { kind: "world"; w: World | null }
  | { kind: "more" };

function Search({ l, a }: { l: Lifeos; a: Actions }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (needle.length < 2) return null;
    const cs = l.data.commitments.filter(c => c.title.toLowerCase().includes(needle)).slice(0, 8);
    const ws = l.data.worlds.filter(w => w.title.toLowerCase().includes(needle)).slice(0, 4);
    return { cs, ws };
  }, [l.data.commitments, l.data.worlds, needle]);
  return (
    <div className={styles.search} role="search">
      <input type="search" aria-label="Search commitments and worlds" placeholder="Search commitments and worlds" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQ(""); }} />
      {results && (
        <div className={styles.results}>
          {results.cs.map(c => <button key={c.id} onClick={() => { setQ(""); a.openEdit(c); }}>{c.title}</button>)}
          {results.ws.map(w => <button key={w.id} onClick={() => { setQ(""); a.openWorld(w); }}>◈ {w.title}</button>)}
          {results.cs.length + results.ws.length === 0 && <div className={styles.muted} style={{ padding: 8 }}>No match in your open commitments, this week or your worlds.</div>}
        </div>
      )}
    </div>
  );
}

export function LifeosApp({ initialScreen }: { initialScreen: Screen }) {
  const l = useLifeos();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [browserTz, setBrowserTz] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      const s = window.location.pathname.split("/")[2];
      setScreen(isScreen(s) ? s : "calendar");
    };
    window.addEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device's time zone exists only in the browser
    setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = (s: Screen) => {
    setScreen(s);
    setDialog(null);
    if (s === "today") l.setOffset(0);
    window.history.pushState(null, "", `/lifeos/${s}`);
    window.scrollTo(0, 0);
  };
  const close = () => setDialog(null);
  const actions: Actions = {
    go,
    openCapture: preset => setDialog({ kind: "capture", preset }),
    openEdit: c => setDialog({ kind: "edit", c }),
    openDelegate: c => setDialog({ kind: "delegate", c }),
    openWorld: w => setDialog({ kind: "world", w }),
  };
  const page = SCREENS[screen];
  const props = { l, a: actions };
  const workspace = l.workspaces.find(w => w.id === l.workspaceId);

  return (
    <div className={styles.root}>
      <div className={styles.layout}>
        <aside className={styles.aside}>
          <h2>Competen <span>LifeOS</span></h2>
          <p className={styles.tagline}>PERSONAL CHIEF OF STAFF</p>
          {l.workspaces.length > 1 && (
            <div className={styles.switcher}>
              <label htmlFor="lo-ws">Workspace</label>
              <select id="lo-ws" value={l.workspaceId ?? ""} onChange={e => l.chooseWorkspace(e.target.value)}>
                {l.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
          <nav aria-label="LifeOS">
            {NAV.map(k => (
              <button key={k} className={k === screen ? styles.active : ""} aria-current={k === screen ? "page" : undefined} onClick={() => go(k)}>
                {SCREENS[k].icon} {SCREENS[k].label}
              </button>
            ))}
          </nav>
          <p className={styles.sidenote}>🔒 Private by default. Nothing is shared unless you share it.</p>
        </aside>
        <main className={styles.main}>
          <header className={styles.header}>
            <div>
              <div className={styles.eyebrow}>A life led by what matters{workspace && l.workspaces.length > 1 ? ` · ${workspace.name}` : ""}</div>
              <h1>{page.icon} {page.label}</h1>
              <div className={styles.muted}>{page.desc}</div>
            </div>
            <div className={styles.headerActions}>
              <Search l={l} a={actions} />
              <button className={styles.primary} onClick={() => actions.openCapture()}>＋ Capture</button>
            </div>
          </header>

          {l.error && <div className={styles.alert} role="alert"><span>{l.error}</span><button onClick={() => l.setError(null)}>Dismiss</button></div>}
          {l.me && browserTz && l.me.timezone !== browserTz && (
            <div className={styles.notice}>
              Your LifeOS days run on {l.me.timezone}, and this device is on {browserTz}.{" "}
              <button disabled={l.busy} onClick={() => l.applyBrowserTimeZone(browserTz)}>Use {browserTz}</button>
            </div>
          )}

          {l.loading ? (
            <div className={styles.card} role="status">Loading your LifeOS…</div>
          ) : l.fatal ? (
            <div className={styles.alert} role="alert"><span>{l.fatal}</span><button onClick={() => l.retry()}>Try again</button></div>
          ) : !l.workspaceId ? (
            <div className={styles.card}>This account has no active workspace yet.</div>
          ) : (
            <>
              {screen === "calendar" && <Calendar {...props} />}
              {screen === "today" && <Today {...props} />}
              {screen === "capture" && <CaptureScreen {...props} form={<CommitmentForm l={l} submitLabel="Save commitment" />} />}
              {screen === "commitments" && <Commitments {...props} />}
              {screen === "worlds" && <Worlds {...props} />}
              {screen === "plan" && <Plan {...props} />}
              {screen === "quadrants" && <Quadrants {...props} />}
              {screen === "review" && <Review {...props} />}
              {screen === "ai" && <ChiefOfStaff {...props} />}
            </>
          )}
        </main>
      </div>

      <nav className={styles.navmobile} aria-label="LifeOS">
        {BOTTOM.map(k => (
          <button key={k} className={k === screen ? styles.active : ""} aria-current={k === screen ? "page" : undefined} onClick={() => go(k)}>{SCREENS[k].icon} {SCREENS[k].label}</button>
        ))}
        <button className={MORE.includes(screen) ? styles.active : ""} onClick={() => setDialog({ kind: "more" })}>☰ More</button>
      </nav>

      {dialog?.kind === "capture" && (
        <Modal title="Quick Capture" onClose={close}>
          <CommitmentForm l={l} preset={dialog.preset} onDone={close} submitLabel="Save commitment" />
          <p><button onClick={close}>Cancel</button></p>
        </Modal>
      )}
      {dialog?.kind === "edit" && (
        <Modal title="Edit commitment" onClose={close}>
          <CommitmentForm
            l={l} c={dialog.c} onDone={close} submitLabel="Save changes"
            rock={l.data.rocks.some(r => r.commitmentId === dialog.c.id)}
            protect={l.data.blocks.some(b => b.commitmentId === dialog.c.id)}
          />
          <p><button onClick={close}>Cancel</button></p>
        </Modal>
      )}
      {dialog?.kind === "delegate" && (
        <Modal title="Delegate with accountability" onClose={close}>
          <p>{dialog.c.title}</p>
          <form onSubmit={async e => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (await l.delegate(dialog.c, String(f.get("person")), String(f.get("date")))) close();
          }}>
            <div className={styles.field}><label htmlFor="lo-person">Responsible person / team</label><input id="lo-person" name="person" required maxLength={200} /></div>
            <div className={styles.field}><label htmlFor="lo-follow">Follow-up date</label><input id="lo-follow" type="date" name="date" required defaultValue={dialog.c.scheduledOn ?? addDays(l.today, 2)} /></div>
            <p className={styles.muted}>You remain the owner of this commitment. Nothing is sent to this person.</p>
            <button className={styles.primary} disabled={l.busy}>Delegate and track</button>{" "}
            <button type="button" onClick={close}>Cancel</button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "world" && (
        <Modal title={dialog.w ? "Edit world" : "Add a world"} onClose={close}>
          <form onSubmit={async e => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await l.saveWorld(dialog.w, {
              title: String(f.get("title")).trim(),
              context: String(f.get("context") ?? "") || null,
              purpose: String(f.get("purpose") ?? "") || null,
            });
            if (ok) close();
          }}>
            <div className={styles.field}><label htmlFor="lo-wt">Role or world</label><input id="lo-wt" name="title" required maxLength={200} defaultValue={dialog.w?.title} placeholder="For example, Family member" /></div>
            <div className={styles.field}><label htmlFor="lo-wc">Where</label><input id="lo-wc" name="context" maxLength={200} defaultValue={dialog.w?.context ?? ""} placeholder="For example, Family" /></div>
            <div className={styles.field}><label htmlFor="lo-wp">What matters here</label><textarea id="lo-wp" name="purpose" maxLength={2000} defaultValue={dialog.w?.purpose ?? ""} /></div>
            <button className={styles.primary} disabled={l.busy}>Save</button>{" "}
            <button type="button" onClick={close}>Cancel</button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "more" && (
        <Modal title="More" onClose={close}>
          {l.workspaces.length > 1 && (
            <div className={styles.field}>
              <label htmlFor="lo-ws-m">Workspace</label>
              <select id="lo-ws-m" value={l.workspaceId ?? ""} onChange={e => { l.chooseWorkspace(e.target.value); close(); }}>
                {l.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
          {MORE.map(k => <button key={k} className={styles.sheetItem} onClick={() => go(k)}>{SCREENS[k].icon} {SCREENS[k].label}</button>)}
          <p><button onClick={close}>Close</button></p>
        </Modal>
      )}
    </div>
  );
}
