"use client";

import { useState } from "react";
import type { Commitment, World } from "./client";
import type { Screen } from "./nav";
import type { Lifeos } from "./useLifeos";
import styles from "./lifeos.module.css";

// LIFEOS-API-001 step 5. The nine screens of the approved V1.1 baseline, reading real records. Anything not yet known
// is shown as such: an empty state says what is missing, never a zero that reads like a measurement.

export const SCREENS: Record<Screen, { label: string; icon: string; desc: string }> = {
  calendar: { label: "Calendar", icon: "▦", desc: "Weekly commitments, with important time protected" },
  today: { label: "Today", icon: "☀", desc: "Execute what matters" },
  capture: { label: "Capture", icon: "＋", desc: "Capture, clarify and classify" },
  commitments: { label: "Commitments", icon: "✓", desc: "One unified commitment engine" },
  worlds: { label: "My Worlds", icon: "◈", desc: "Roles, goals and boundaries" },
  plan: { label: "Weekly Plan", icon: "▤", desc: "Roles before tasks; Big Rocks before pebbles" },
  quadrants: { label: "Four Quadrants", icon: "▦", desc: "Importance before urgency" },
  review: { label: "Weekly Review", icon: "↻", desc: "Reflect and improve" },
  ai: { label: "Chief of Staff", icon: "✦", desc: "Recommendations requiring your approval" },
  organisation: { label: "Organisation", icon: "▣", desc: "Who is invited, and how your organisation appears" },
};

export type Actions = {
  go: (s: Screen) => void;
  openCapture: (preset?: { date?: string; worldId?: string }) => void;
  openEdit: (c: Commitment) => void;
  openDelegate: (c: Commitment) => void;
  openWorld: (w: World | null) => void;
};

type Props = { l: Lifeos; a: Actions };

const fmt = (x: string | null) => (x ? new Date(`${x}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "Unscheduled");
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
const inWeek = (l: Lifeos, c: Commitment) => !!c.scheduledOn && l.days.includes(c.scheduledOn);
const isLive = (c: Commitment) => c.status !== "done" && c.status !== "dropped";
const sortByTime = (a: Commitment, b: Commitment) => (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "");

function useFacts(l: Lifeos) {
  const protectedIds = new Set(l.data.blocks.map(b => b.commitmentId).filter(Boolean));
  const rockIds = new Set(l.data.rocks.map(r => r.commitmentId));
  const delegatedTo = new Map(l.data.delegations.map(d => [d.commitmentId, d]));
  const world = (id: string | null) => l.data.worlds.find(w => w.id === id);
  return { protectedIds, rockIds, delegatedTo, world };
}

function Task({ c, l, a }: Props & { c: Commitment }) {
  const f = useFacts(l);
  const d = f.delegatedTo.get(c.id);
  const rock = f.rockIds.has(c.id);
  return (
    <div className={styles.task}>
      <div className={styles.row}>
        <strong>{c.title}</strong>
        <span className={`${styles.tag} ${c.quadrant ? styles[c.quadrant] : ""}`}>{c.quadrant ? c.quadrant.toUpperCase() : "Not classified"}</span>
      </div>
      <div className={styles.muted}>
        {f.world(c.worldId)?.title ?? "No world yet"} · {fmt(c.scheduledOn)} {hhmm(c.scheduledTime)}
        {rock ? " · ◆ Big Rock" : ""}{f.protectedIds.has(c.id) ? " · 🔒 Protected Q2" : ""}
        {d ? ` · ↗ ${d.delegateeLabel ?? "A member"}, follow up ${fmt(d.followUpOn)}` : ""}
      </div>
      <div className={styles.actions}>
        <button disabled={l.busy} onClick={() => l.toggleDone(c)}>{c.status === "done" ? "↶ Reopen" : "✓ Complete"}</button>
        <button disabled={l.busy} onClick={() => a.openEdit(c)}>✎ Edit / schedule</button>
        {c.status !== "done" && c.status !== "delegated" && <button disabled={l.busy} onClick={() => a.openDelegate(c)}>↗ Delegate</button>}
        <button disabled={l.busy} onClick={() => l.toggleRock(c, !rock)}>{rock ? "◆ Unmark rock" : "◇ Big Rock"}</button>
      </div>
    </div>
  );
}

function WeekNav({ l }: { l: Lifeos }) {
  return (
    <div className={styles.actions}>
      <button aria-label="Previous week" onClick={() => l.setOffset(l.offset - 1)}>‹</button>
      <button onClick={() => l.setOffset(0)}>This week</button>
      <button aria-label="Next week" onClick={() => l.setOffset(l.offset + 1)}>›</button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.card}><div className={styles.muted}>{label}</div><div className={styles.stat}>{value}</div></div>;
}

export function Calendar({ l, a }: Props) {
  const f = useFacts(l);
  const week = l.data.commitments.filter(c => inWeek(l, c));
  const rocks = week.filter(c => f.rockIds.has(c.id));
  const inbox = l.data.commitments.filter(c => c.status === "inbox");
  return (
    <>
      <div className={styles.three}>
        <Stat label="Week commitments" value={week.length} />
        <Stat label="Protected Q2" value={week.filter(c => isLive(c) && f.protectedIds.has(c.id)).length} />
        <Stat label="Big Rocks completed" value={`${rocks.filter(c => c.status === "done").length}/${rocks.length}`} />
      </div>
      <div className={styles.card}>
        <div className={styles.row}><h2>Weekly calendar</h2><WeekNav l={l} /></div>
        <div className={styles.week}>
          {l.days.map(date => (
            <div key={date} className={`${styles.day} ${date === l.today ? styles.today : ""}`}>
              <strong>{fmt(date)}</strong>
              {week.filter(c => c.scheduledOn === date && c.status !== "inbox").sort(sortByTime).map(c => (
                <button key={c.id} className={`${styles.event} ${f.protectedIds.has(c.id) ? styles.protected : ""} ${c.status === "done" ? styles.doneEvent : ""}`} onClick={() => a.openEdit(c)}>
                  {hhmm(c.scheduledTime)} {c.title} {f.rockIds.has(c.id) ? "◆" : ""}
                </button>
              ))}
              <button aria-label={`Add to ${fmt(date)}`} onClick={() => a.openCapture({ date })}>＋</button>
            </div>
          ))}
        </div>
        <p className={styles.muted}>Gold indicates protected Q2 time. Tap an event to edit. Scroll sideways on a phone.</p>
      </div>
      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>Needs clarification</h2>
          {inbox.map(c => <Task key={c.id} c={c} l={l} a={a} />)}
          {inbox.length === 0 && "Inbox clear"}
        </div>
        <div className={`${styles.card} ${styles.ai}`}>
          <h2>✦ Chief of Staff</h2>
          <p className={styles.muted}>Check your priorities, protect Q2, and consider intelligent replanning.</p>
          <button onClick={() => a.go("ai")}>Review recommendations</button>
        </div>
      </div>
    </>
  );
}

export function Today({ l, a }: Props) {
  const f = useFacts(l);
  const items = l.data.commitments.filter(c => c.scheduledOn === l.today && c.status !== "inbox").sort(sortByTime);
  const rocks = items.filter(c => f.rockIds.has(c.id));
  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <h2>{"Today's commitments"}</h2>
        {items.map(c => <Task key={c.id} c={c} l={l} a={a} />)}
        {items.length === 0 && <p>A clear day.</p>}
        <button className={styles.primary} onClick={() => a.openCapture({ date: l.today })}>＋ Add today</button>
      </div>
      <div>
        <div className={styles.card}>
          <h2>{"Today's Big Rocks"}</h2>
          {rocks.map(c => <p key={c.id}>◆ {c.title}</p>)}
          {rocks.length === 0 && "Select a Big Rock."}
        </div>
        <div className={`${styles.card} ${styles.ai}`}>
          <h2>Unexpected interruption?</h2>
          <p className={styles.muted}>Propose a move without silently overwriting your plan.</p>
          <button disabled={l.busy} onClick={async () => { if (await l.generate(true)) a.go("ai"); }}>Propose a replan</button>
        </div>
      </div>
    </div>
  );
}

export function CaptureScreen({ l, a, form }: Props & { form: React.ReactNode }) {
  const inbox = l.data.commitments.filter(c => c.status === "inbox");
  return (
    <div className={styles.grid}>
      <div className={styles.card}><h2>Quick Capture</h2>{form}</div>
      <div className={styles.card}>
        <h2>Inbox</h2>
        {inbox.map(c => <Task key={c.id} c={c} l={l} a={a} />)}
        {inbox.length === 0 && "All captured items clarified."}
        <div className={styles.notice} style={{ marginTop: 12 }}>Capture is not automatically a commitment to do something today.</div>
      </div>
    </div>
  );
}

export function Commitments({ l, a }: Props) {
  const groups: [string, string][] = [["inbox", "Needs clarification"], ["planned", "Scheduled"], ["in_progress", "In progress"], ["delegated", "Waiting on others"], ["done", "Completed this week"]];
  return (
    <div className={styles.card}>
      <h2>Unified Commitment Engine</h2>
      <p className={styles.muted}>Delegation retains ownership and follow-through.</p>
      {groups.map(([st, label]) => {
        const items = l.data.commitments.filter(c => c.status === st);
        return (
          <div key={st}>
            <h3>{label} ({items.length})</h3>
            {items.map(c => <Task key={c.id} c={c} l={l} a={a} />)}
            {items.length === 0 && <p className={styles.muted}>None</p>}
          </div>
        );
      })}
    </div>
  );
}

export function Worlds({ l, a }: Props) {
  return (
    <>
      <div className={styles.notice}>🔒 Every commitment belongs to one role or world. What you hold here stays private to you unless you choose to share it.</div>
      <button className={styles.primary} style={{ marginBottom: 14 }} onClick={() => a.openWorld(null)}>＋ Add a world</button>
      {l.data.worlds.length === 0 && <div className={styles.card}>You have no worlds yet. Add the roles you hold, such as family, work or community.</div>}
      <div className={styles.grid}>
        {l.data.worlds.map(w => {
          const live = l.data.commitments.filter(c => isLive(c) && c.worldId === w.id);
          return (
            <div key={w.id} className={`${styles.card} ${styles.role}`}>
              <h2>{w.title}</h2>
              <p className={styles.muted}>{[w.context, w.purpose].filter(Boolean).join(" · ") || "No purpose written yet"}</p>
              <strong>{live.length} open commitments</strong>
              {live.slice(0, 3).map(c => <p key={c.id}>• {c.title}</p>)}
              <div className={styles.actions}><button onClick={() => a.openWorld(w)}>✎ Edit</button></div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Plan({ l, a }: Props) {
  const f = useFacts(l);
  const [intent, setIntent] = useState<{ week: string; text: string } | null>(null);
  const shown = intent?.week === l.weekStart ? intent.text : (l.data.plan?.intention ?? "");
  const changed = shown !== (l.data.plan?.intention ?? "");
  const week = l.data.commitments.filter(c => inWeek(l, c));
  return (
    <>
      <div className={styles.card}>
        <h2>Begin with the end in mind. Put first things first.</h2>
        <div className={styles.field}>
          <label htmlFor="lo-intent">Weekly intention</label>
          <textarea id="lo-intent" value={shown} onChange={e => setIntent({ week: l.weekStart, text: e.target.value })} />
        </div>
        <div className={styles.row}>
          <span>{fmt(l.days[0])} – {fmt(l.days[6])}</span>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={!changed || l.busy} onClick={() => l.saveIntention(shown)}>Save intention</button>
            <WeekNav l={l} />
          </div>
        </div>
      </div>
      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>1 · Review your roles</h2>
          {l.data.worlds.length === 0 && <button onClick={() => a.go("worlds")}>Add your first world</button>}
          {l.data.worlds.map(w => (
            <div key={w.id} className={styles.task}>
              <strong>{w.title}</strong>
              <p className={styles.muted}>{w.purpose ?? "No purpose written yet"}</p>
              <button onClick={() => a.openCapture({ date: l.days[0], worldId: w.id })}>＋ Add weekly outcome</button>
            </div>
          ))}
        </div>
        <div>
          <div className={styles.card}>
            <h2>2 · Select Big Rocks</h2>
            {week.filter(c => f.rockIds.has(c.id)).map(c => <Task key={c.id} c={c} l={l} a={a} />)}
            {week.filter(c => f.rockIds.has(c.id)).length === 0 && "No Big Rocks yet."}
          </div>
          <div className={styles.card}>
            <h2>3 · Protect Quadrant 2</h2>
            {week.filter(c => f.protectedIds.has(c.id)).map(c => <p key={c.id}>🔒 {c.title}</p>)}
            {week.filter(c => f.protectedIds.has(c.id)).length === 0 && <p>No protected blocks.</p>}
            <button onClick={() => a.openCapture({ date: l.days[2] })}>＋ Add Q2 commitment</button>
          </div>
          <div className={styles.card}>
            <h2>4 · Schedule your week</h2>
            <button className={styles.primary} onClick={() => a.go("calendar")}>Open calendar</button>
          </div>
        </div>
      </div>
    </>
  );
}

export function Quadrants({ l, a }: Props) {
  const live = l.data.commitments.filter(isLive);
  const defs: ["q1" | "q2" | "q3" | "q4", string, string][] = [
    ["q1", "Urgent + important", "Act on genuine deadlines"],
    ["q2", "Important + not urgent", "Invest in prevention, preparation and relationships"],
    ["q3", "Urgent + not important", "Question, decline or delegate"],
    ["q4", "Neither urgent nor important", "Reduce or choose intentionally"],
  ];
  const unclassified = live.filter(c => !c.quadrant);
  return (
    <>
      <div className={styles.notice}>Importance and urgency are independent decisions. Quadrants are calculated, not assigned arbitrarily.</div>
      <div className={styles.quadrants}>
        {defs.map(([q, title, hint]) => {
          const items = live.filter(c => c.quadrant === q);
          return (
            <div key={q} className={`${styles.quad} ${styles[q]}`}>
              <h2>{q.toUpperCase()} · {title}</h2>
              <p className={styles.muted}>{hint}</p>
              {items.map(c => <Task key={c.id} c={c} l={l} a={a} />)}
              {items.length === 0 && "No commitments"}
            </div>
          );
        })}
      </div>
      {unclassified.length > 0 && (
        <div className={styles.card} style={{ marginTop: 14 }}>
          <h2>Not classified yet ({unclassified.length})</h2>
          {unclassified.map(c => <Task key={c.id} c={c} l={l} a={a} />)}
        </div>
      )}
    </>
  );
}

export function Review({ l, a }: Props) {
  const f = useFacts(l);
  const key = l.data.review?.id ?? l.weekStart;
  const [draft, setDraft] = useState<{ key: string; reflection: string; focus: string } | null>(null);
  const reflection = draft?.key === key ? draft.reflection : (l.data.review?.reflection ?? "");
  const focus = draft?.key === key ? draft.focus : (l.data.review?.nextWeekFocus ?? "");
  const finalised = l.data.review?.status === "final";
  const week = l.data.commitments.filter(c => inWeek(l, c));
  const done = week.filter(c => c.status === "done");
  const open = week.filter(c => c.status !== "done");
  return (
    <>
      <div className={styles.row} style={{ marginBottom: 10 }}>
        <span>{fmt(l.days[0])} – {fmt(l.days[6])}</span>
        <WeekNav l={l} />
      </div>
      <div className={styles.grid}>
        <div className={styles.card}>
          <h2>Weekly outcomes</h2>
          <div className={styles.three}>
            <div><div className={styles.stat}>{done.length}</div><div className={styles.muted}>Completed</div></div>
            <div><div className={styles.stat}>{done.filter(c => f.rockIds.has(c.id)).length}</div><div className={styles.muted}>Big Rocks achieved</div></div>
            <div><div className={styles.stat}>{week.filter(c => f.protectedIds.has(c.id)).length}</div><div className={styles.muted}>Q2 blocks</div></div>
          </div>
          <h3>Accomplishments</h3>
          {done.map(c => <p key={c.id}>✓ {c.title}</p>)}
          {done.length === 0 && "Nothing completed yet."}
          <h3>Follow-through</h3>
          {open.map(c => <p key={c.id}>○ {c.title}</p>)}
          {open.length === 0 && "All clear."}
        </div>
        <div className={styles.card}>
          <h2>Reflect and improve</h2>
          <p className={styles.muted}>What worked? Which roles need attention? What should be protected next week?</p>
          <div className={styles.field}>
            <label htmlFor="lo-reflect">Reflection</label>
            <textarea id="lo-reflect" disabled={finalised} value={reflection} onChange={e => setDraft({ key, reflection: e.target.value, focus })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="lo-focus">Focus for next week</label>
            <textarea id="lo-focus" disabled={finalised} value={focus} onChange={e => setDraft({ key, reflection, focus: e.target.value })} />
          </div>
          {finalised ? (
            <p className={styles.notice}>This week is finalised. Its counts are stored with the review.</p>
          ) : (
            <div className={styles.actions}>
              <button className={styles.primary} disabled={l.busy} onClick={() => l.saveReview({ reflection, nextWeekFocus: focus }, false)}>Save reflection</button>
              <button disabled={l.busy} onClick={() => { if (window.confirm("Finalise this week? The review can no longer be edited.")) void l.saveReview({ reflection, nextWeekFocus: focus }, true); }}>Finalise the week</button>
            </div>
          )}
          <p><button onClick={() => { l.setOffset(l.offset + 1); a.go("plan"); }}>Plan next week →</button></p>
        </div>
      </div>
    </>
  );
}

export function ChiefOfStaff({ l }: Props) {
  const inbox = l.data.commitments.filter(c => c.status === "inbox").length;
  const q2Open = l.data.commitments.filter(c => isLive(c) && c.quadrant === "q2" && !l.data.blocks.some(b => b.commitmentId === c.id)).length;
  const dueBack = l.data.delegations.filter(d => d.followUpOn <= l.today).length;
  return (
    <div className={styles.grid}>
      <div>
        <div className={`${styles.card} ${styles.ai}`}>
          <h2>✦ Personal Chief of Staff</h2>
          <p className={styles.muted}>Recommendations come from fixed rules applied to your own commitments in this workspace. No AI model or outside service is used. Nothing changes until you approve it.</p>
          <div className={styles.actions}>
            <button disabled={l.busy} onClick={() => l.generate(false)}>Refresh recommendations</button>
            <button disabled={l.busy} onClick={() => l.generate(true)}>Propose a replan for an interruption</button>
          </div>
        </div>
        <div className={styles.card}>
          <h2>Priority observations</h2>
          <p>{q2Open} important, non-urgent commitments have no protected time.</p>
          <p>{inbox} items await clarification.</p>
          <p>{dueBack} delegated items are due for follow-through.</p>
        </div>
      </div>
      <div className={styles.card}>
        <h2>Awaiting your decision ({l.data.suggestions.length})</h2>
        {l.data.suggestions.length === 0 && <p className={styles.muted}>No recommendations are waiting. Refresh to check again.</p>}
        {l.data.suggestions.map(s => (
          <div key={s.id} className={styles.task}>
            <div className={styles.eyebrow}>{s.materiality === "material" ? "Proposal · not yet applied" : "For your attention"}</div>
            <strong>{s.title}</strong>
            <p className={styles.muted}>{s.rationale}</p>
            <div className={styles.actions}>
              {s.materiality === "material" && <button className={styles.primary} disabled={l.busy} onClick={() => l.decide(s, true)}>Approve</button>}
              <button disabled={l.busy} onClick={() => l.decide(s, false)}>{s.materiality === "material" ? "Keep original plan" : "Dismiss"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

