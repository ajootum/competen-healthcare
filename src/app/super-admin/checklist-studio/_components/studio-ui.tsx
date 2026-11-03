"use client";
// Checklist Studio: small shared client pieces. Theme tokens only (--cmp-*), the assessment component kit for controls.
import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Btn, Chip, type Tone } from "@/components/assessment/ui";
import { STATE_LABEL, type LifecycleState, type StudioIssue } from "@/lib/assessment/studio/types";

/** Every Studio page sits inside a theme root, because the assessment components read --cmp-* tokens from an ancestor. */
export function StudioShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div data-cmp-theme="platform" className={`space-y-5 text-[var(--cmp-app-text)] ${wide ? "max-w-7xl" : "max-w-6xl"}`}>
      {children}
    </div>
  );
}

export function PageHead({ title, lede, crumbs, right, kicker = "Competen Holdings, Checklist Studio" }: { title: string; lede?: string; crumbs?: { href?: string; label: string }[]; right?: ReactNode; kicker?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-[var(--cmp-app-text-secondary)]">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.href ? <Link href={c.href} className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <span aria-hidden>/</span>}
              </span>
            ))}
          </nav>
        )}
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--cmp-theme-ink)]">{kicker}</p>
        <h1 className="text-xl font-bold">{title}</h1>
        {lede && <p className="mt-1 max-w-3xl text-sm text-[var(--cmp-app-text-secondary)]">{lede}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

const STATE_TONE: Record<LifecycleState, Tone> = { draft: "neutral", in_review: "warning", approved: "info", published: "success", retired: "neutral" };
export const StateChip = ({ state }: { state: LifecycleState | null }) => (state ? <Chip tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Chip> : <Chip>No version yet</Chip>);

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const t = tone === "error" ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : tone === "success" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
    : tone === "warning" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]";
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border border-[var(--cmp-app-border)] px-3 py-2 text-sm ${t}`}>{children}</div>;
}

export const Panel = ({ title, children, right, id }: { title?: string; children: ReactNode; right?: ReactNode; id?: string }) => (
  <section id={id} className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4">
    {(title || right) && (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {title && <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--cmp-app-text-secondary)]">{title}</h2>}
        {right}
      </div>
    )}
    {children}
  </section>
);

export interface ApiOk<T = Record<string, unknown>> { ok: true; data: T }
export interface ApiErr { ok: false; status: number; error: string; data: Record<string, unknown> }

/** One fetch helper. The server answers { error } with a status, and 422 can carry a validation report. */
export async function callApi<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<ApiOk<T> | ApiErr> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "The change could not be saved.", data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your connection and try again.", data: {} };
  }
}

/** Busy flag and last message for a screen that makes several calls. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const run = useCallback(async <T,>(name: string, fn: () => Promise<ApiOk<T> | ApiErr>, o: { ok?: string; refresh?: boolean; onOk?: (d: T) => void; onErr?: (e: ApiErr) => void } = {}) => {
    setBusy(name); setMsg(null);
    const r = await fn();
    setBusy(null);
    if (r.ok) {
      if (o.ok) setMsg({ tone: "success", text: o.ok });
      o.onOk?.(r.data);
      if (o.refresh !== false) router.refresh();
    } else {
      setMsg({ tone: "error", text: r.error });
      o.onErr?.(r);
    }
    return r;
  }, [router]);
  return { busy, msg, setMsg, run, router };
}

export function IssueList({ issues, tone }: { issues: StudioIssue[]; tone: "error" | "warning" }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1 text-sm">
      {issues.map((i, n) => (
        <li key={n} className={tone === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-warning)]"}>
          <span className="font-semibold">{i.source ?? ""}</span>{i.source ? ": " : ""}{i.message} <code className="text-xs opacity-70">{i.path}</code>
        </li>
      ))}
    </ul>
  );
}

export { Btn, Chip };
export const linkBtn = "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-sm font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cmp-theme-accent)]";
export const linkPrimary = "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-accent)] px-3 text-sm font-semibold text-[var(--cmp-theme-on-accent)] hover:bg-[var(--cmp-theme-strong)] pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cmp-theme-accent)]";
export const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-[var(--cmp-app-text-secondary)]";
export const td = "px-3 py-2 align-top text-sm";
