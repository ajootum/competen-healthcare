import type { ReactNode } from "react";
import { STATUS_LABEL, STATUS_TONE, type StatusCode, type Tone } from "@/lib/assessment/catalogue/shape";

// Shared presentation for the Assessment & Checklist Catalogue. Plain components, no state. Colours carry meaning here
// (a status is never a colour alone: the word is always printed), and every control meets the touch minimum by pointer.

export const BASE = "/super-admin/assessment-catalogue";

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-gray-100 text-gray-800",
  neutral: "bg-slate-100 text-slate-800",
  info: "bg-blue-50 text-blue-900",
  warn: "bg-amber-50 text-amber-900",
  good: "bg-green-50 text-green-900",
};

export function StatusBadge({ status }: { status: StatusCode }) {
  return <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] font-bold ${TONE_CLASS[STATUS_TONE[status]]}`}>{STATUS_LABEL[status]}</span>;
}

export function CodeChip({ code }: { code: string }) {
  return <span className="inline-block whitespace-nowrap rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[11.5px] font-bold text-teal-900">{code}</span>;
}

export function Chip({ children, tone = "muted", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}>{children}</span>;
}

export const btn = "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
export const btnPrimary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
export const btnGhost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
export const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500/40 pointer-coarse:min-h-[var(--cmp-touch-min)]";

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-gray-100 py-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">{title}</h3>
          {hint && <p className="mt-0.5 text-[12px] text-gray-600">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-1.5 text-[13px] last:border-0">
      <span className="text-gray-600">{label}</span>
      <span className="text-right text-gray-900">{value ?? <span className="text-gray-500">{"—"}</span>}</span>
    </div>
  );
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** POST to the catalogue API. Returns an error text, or null on success. */
export async function callApi(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; error: string | null; json: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, error: r.ok ? null : String(json.error ?? "That did not work. Try again."), json };
  } catch {
    return { ok: false, error: "The server could not be reached. Try again.", json: {} };
  }
}
