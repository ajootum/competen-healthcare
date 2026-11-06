"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, mondayOf, todayIn } from "../core/time";
import { startInstant } from "../core/suggestions";
import {
  ApiError, all, get, patch, post,
  type BigRock, type Commitment, type Delegation, type Entitlement, type Individual, type Me, type ProtectedBlock, type Suggestion,
  type WeeklyPlan, type WeeklyReview, type Workspace, type World,
} from "./client";

// The interface's whole view of one workspace, loaded through the API. After each change it reloads rather than
// guessing, so what is on screen is always what the server holds.

const WS_KEY = "lifeos.workspace";
const OPEN = ["inbox", "planned", "in_progress", "delegated"];

export type Data = {
  worlds: World[];
  commitments: Commitment[];
  blocks: ProtectedBlock[];
  delegations: Delegation[];
  plan: WeeklyPlan | null;
  rocks: BigRock[];
  review: WeeklyReview | null;
  suggestions: Suggestion[];
};

const EMPTY: Data = { worlds: [], commitments: [], blocks: [], delegations: [], plan: null, rocks: [], review: null, suggestions: [] };

export type CommitmentFields = {
  title: string;
  worldId: string | null;
  important: boolean | null;
  urgent: boolean | null;
  scheduledOn: string | null;
  scheduledTime: string | null;
  estimatedMinutes: number | null;
};

export function useLifeos(tenantId: string | null = null) {
  const [me, setMe] = useState<Individual | null>(null);
  const [chosenAccess, setChosenAccess] = useState<Entitlement | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const timeZone = me?.timezone ?? "UTC";
  const today = todayIn(timeZone);
  const weekStart = addDays(mondayOf(today), offset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const base = workspaceId ? `/workspaces/${workspaceId}` : "";

  const loadMe = useCallback(async () => {
    try {
      const m = await get<Me>("/me");
      setMe(m.individual);
      setChosenAccess(m.entitlements.find(e => e.source === "competen_individual") ?? null);
      // On a tenant's domain the person sees that organisation and their own personal workspace, and no other organisation.
      const visible = tenantId ? m.workspaces.filter(w => w.kind === "personal" || w.tenantId === tenantId) : m.workspaces;
      setWorkspaces(visible);
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(WS_KEY) : null;
      const pick = visible.find(w => w.id === saved)
        ?? (tenantId ? visible.find(w => w.tenantId === tenantId) : null)
        ?? visible.find(w => w.kind === "personal") ?? visible[0];
      setWorkspaceId(pick?.id ?? null);
      if (!pick) setLoading(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { window.location.reload(); return; }
      setFatal(e instanceof Error ? e.message : "LifeOS could not be reached.");
      setLoading(false);
    }
  }, [tenantId]);

  const reload = useCallback(async () => {
    if (!base) return;
    const seq = ++loadSeq.current;
    const end = addDays(weekStart, 6);
    try {
      const [worlds, open, week, blocks, delegations, plans, reviews, suggestions] = await Promise.all([
        all<World>(`${base}/worlds`),
        Promise.all(OPEN.map(s => all<Commitment>(`${base}/commitments?status=${s}`))),
        all<Commitment>(`${base}/commitments?scheduledFrom=${weekStart}&scheduledTo=${end}`),
        all<ProtectedBlock>(`${base}/protected-blocks?status=active`),
        all<Delegation>(`${base}/delegations?status=active`),
        all<WeeklyPlan>(`${base}/weekly-plans?weekStart=${weekStart}`),
        all<WeeklyReview>(`${base}/weekly-reviews?weekStart=${weekStart}`),
        all<Suggestion>(`${base}/suggestions?status=proposed`),
      ]);
      const plan = plans.find(p => p.ownerIndividualId === me?.id) ?? null;
      const rocks = plan ? await all<BigRock>(`${base}/big-rocks?weeklyPlanId=${plan.id}&status=selected`) : [];
      if (seq !== loadSeq.current) return;
      const merged = new Map<string, Commitment>();
      for (const c of [...open.flat(), ...week]) merged.set(c.id, c);
      setData({
        worlds, commitments: [...merged.values()], blocks, delegations, plan, rocks, suggestions,
        review: reviews.find(r => r.ownerIndividualId === me?.id) ?? null,
      });
      setFatal(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setFatal(e instanceof Error ? e.message : "LifeOS could not be reached.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [base, weekStart, me?.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read is from the API, so it can only start after mount
  useEffect(() => { void loadMe(); }, [loadMe]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the API again when the workspace or week changes
  useEffect(() => { void reload(); }, [reload]);

  /** Runs one user action. Failures are shown, and the view always reloads to what the server holds. */
  const act = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be completed.");
      if (e instanceof ApiError && e.code === "version_conflict") await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const chooseWorkspace = useCallback((id: string) => {
    window.localStorage.setItem(WS_KEY, id);
    setLoading(true);
    setData(EMPTY);
    setWorkspaceId(id);
  }, []);

  // ---- the plan for a week: created on first need, and active, so the Chief of Staff can see it ----
  const ensurePlan = useCallback(async (week: string): Promise<WeeklyPlan> => {
    const found = (await all<WeeklyPlan>(`${base}/weekly-plans?weekStart=${week}`)).find(p => p.ownerIndividualId === me?.id);
    if (found) return found;
    const made = await post<WeeklyPlan>(`${base}/weekly-plans`, { weekStart: week });
    return post<WeeklyPlan>(`${base}/weekly-plans/${made.id}/transition`, { to: "active", expectedVersion: made.version });
  }, [base, me?.id]);

  const setRock = useCallback(async (c: Commitment, on: boolean) => {
    if (!c.scheduledOn) throw new ApiError(422, "validation_failed", "Give this commitment a date before making it a Big Rock.");
    const plan = await ensurePlan(mondayOf(c.scheduledOn));
    const [rock] = await all<BigRock>(`${base}/big-rocks?weeklyPlanId=${plan.id}&commitmentId=${c.id}`);
    if (rock) {
      if ((rock.status === "selected") === on) return;
      await post(`${base}/big-rocks/${rock.id}/transition`, { to: on ? "selected" : "removed", expectedVersion: rock.version });
    } else if (on) {
      await post(`${base}/big-rocks`, { weeklyPlanId: plan.id, commitmentId: c.id });
    }
  }, [base, ensurePlan]);

  const setProtected = useCallback(async (c: Commitment, on: boolean) => {
    const blocks = await all<ProtectedBlock>(`${base}/protected-blocks?commitmentId=${c.id}&status=active`);
    if (!on) {
      for (const b of blocks) await post(`${base}/protected-blocks/${b.id}/transition`, { to: "released", expectedVersion: b.version });
      return;
    }
    if (!c.scheduledOn || !c.scheduledTime) throw new ApiError(422, "validation_failed", "Give this commitment a date and a time before protecting it.");
    const startsAt = startInstant(c.scheduledOn, c.scheduledTime, timeZone);
    const endsAt = new Date(new Date(startsAt).getTime() + (c.estimatedMinutes ?? 45) * 60000).toISOString();
    if (blocks[0]) {
      // The person moved a protected commitment themselves, so its protected time goes with it.
      await patch(`${base}/protected-blocks/${blocks[0].id}`, { expectedVersion: blocks[0].version, startsAt, endsAt, label: c.title });
    } else {
      await post(`${base}/protected-blocks`, { commitmentId: c.id, worldId: c.worldId, label: c.title, startsAt, endsAt, timeZone });
    }
  }, [base, timeZone]);

  const capture = useCallback((f: CommitmentFields) => act(() => post(`${base}/commitments`, f)), [act, base]);

  const saveCommitment = useCallback((c: Commitment, f: CommitmentFields, rock: boolean, protect: boolean) => act(async () => {
    let cur = c;
    // A planned commitment needs a date, so clearing the date moves it back to the inbox first.
    if (cur.status === "planned" && !f.scheduledOn) {
      cur = await post<Commitment>(`${base}/commitments/${c.id}/transition`, { to: "inbox", expectedVersion: cur.version, scheduledOn: null, scheduledTime: null });
    }
    const updated = await patch<Commitment>(`${base}/commitments/${c.id}`, { ...f, expectedVersion: cur.version });
    cur = updated;
    if (cur.status === "inbox" && f.scheduledOn && f.worldId && f.important !== null && f.urgent !== null) {
      cur = await post<Commitment>(`${base}/commitments/${c.id}/transition`, { to: "planned", expectedVersion: cur.version });
    }
    await setRock(cur, rock).catch(e => { if (rock) throw e; });
    await setProtected(cur, protect);
  }), [act, base, setRock, setProtected]);

  const toggleDone = useCallback((c: Commitment) => act(() => {
    if (c.status === "done") {
      const clarified = !!c.worldId && c.important !== null && c.urgent !== null;
      const to = clarified ? (c.scheduledOn ? "planned" : "in_progress") : "inbox";
      return post(`${base}/commitments/${c.id}/transition`, { to, expectedVersion: c.version });
    }
    return post(`${base}/commitments/${c.id}/transition`, { to: "done", expectedVersion: c.version });
  }), [act, base]);

  const toggleRock = useCallback((c: Commitment, on: boolean) => act(() => setRock(c, on)), [act, setRock]);

  const delegate = useCallback((c: Commitment, label: string, followUpOn: string) =>
    act(() => post(`${base}/delegations`, { commitmentId: c.id, delegateeLabel: label, followUpOn })), [act, base]);

  const saveWorld = useCallback((w: World | null, f: { title: string; context: string | null; purpose: string | null }) => act(() => (
    w ? patch(`${base}/worlds/${w.id}`, { ...f, expectedVersion: w.version }) : post(`${base}/worlds`, f)
  )), [act, base]);

  const saveIntention = useCallback((intention: string) => act(async () => {
    const plan = await ensurePlan(weekStart);
    await patch(`${base}/weekly-plans/${plan.id}`, { intention, expectedVersion: plan.version });
  }), [act, base, ensurePlan, weekStart]);

  const saveReview = useCallback((f: { reflection: string; nextWeekFocus: string }, finalise: boolean) => act(async () => {
    let r = data.review;
    if (r) r = await patch<WeeklyReview>(`${base}/weekly-reviews/${r.id}`, { ...f, expectedVersion: r.version });
    else r = await post<WeeklyReview>(`${base}/weekly-reviews`, { weekStart, weeklyPlanId: data.plan?.id ?? null, ...f });
    if (finalise && r) await post(`${base}/weekly-reviews/${r.id}/transition`, { to: "final", expectedVersion: r.version });
  }), [act, base, data.plan?.id, data.review, weekStart]);

  const generate = useCallback((interruption: boolean) => act(() => post(`${base}/suggestions/generate`, { interruption })), [act, base]);
  const decide = useCallback((s: Suggestion, accept: boolean) => act(() => post(`${base}/suggestions/${s.id}/${accept ? "accept" : "dismiss"}`, {})), [act, base]);

  const applyBrowserTimeZone = useCallback((tz: string) => act(async () => {
    if (!me) return;
    await patch("/me", { timezone: tz, expectedVersion: me.version });
    await loadMe();
  }), [act, loadMe, me]);

  const turnOff = useCallback(async () => {
    if (!chosenAccess) return;
    const ok = await act(() => post(`/me/entitlements/${chosenAccess.id}/end`, { expectedVersion: chosenAccess.version }));
    if (ok) window.location.reload();
  }, [act, chosenAccess]);

  return {
    chosenAccess, turnOff, me, workspaces, workspaceId, chooseWorkspace, offset, setOffset, today, weekStart, days, timeZone, data, loading, busy, error, setError, fatal,
    retry: reload, capture, saveCommitment, toggleDone, toggleRock, delegate, saveWorld, saveIntention, saveReview, generate, decide, applyBrowserTimeZone,
  };
}

export type Lifeos = ReturnType<typeof useLifeos>;
