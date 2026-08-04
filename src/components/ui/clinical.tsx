import Link from "next/link";
import { classifyPews, levelFromBands, W_LEVELS, I_LEVELS, A_LEVELS } from "@/lib/hww/instruments";
import { Badge, Progress, cardClass, type BadgeTone } from "./primitives";
import { formatDateTime } from "@/lib/datetime";

// Clinical components (PUI-004 s8) — patient cards, acuity indicators, PEWS/NAS score widgets, task cards,
// quality event cards, shift summary widgets.
//
// THE POINT OF THESE: every one of them derives its band from the SHIPPED instrument logic
// (@/lib/hww/instruments) rather than carrying its own copy of the thresholds. A component that re-declared
// "PEWS 5+ is red" would silently disagree with the engine the moment a band moved — and a display that
// disagrees with the record is worse than no display. classifyPews and levelFromBands are the same
// functions the assessment write-path uses.
//
// Colour is always paired with the band's WORD, per PUI-005. There is no variant that shows the colour
// alone, and `null` scores render "not assessed" rather than a zero that would read as a measurement.

// ── Acuity (op_patients.acuity_level, the operational spine) ────────────────────────────────────────────
const ACUITY_TONE: Record<string, BadgeTone> = {
  stable: "success", moderate: "warning", high: "error", critical: "critical",
  discharged: "neutral", deceased: "neutral",
};

export function AcuityIndicator({ level }: { level: string | null | undefined }) {
  if (!level) return <Badge tone="neutral">Not recorded</Badge>;
  const label = level.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return <Badge tone={ACUITY_TONE[level] ?? "neutral"}>{label}</Badge>;
}

// ── PEWS (ward acuity) ──────────────────────────────────────────────────────────────────────────────────
// category3 is the special trigger: any single category scored 3 forces red regardless of total. It is a
// prop rather than an internal guess, because only the recorded assessment knows.
export function PewsBadge({ score, category3 = false }: { score: number | null | undefined; category3?: boolean }) {
  if (score == null) return <Badge tone="neutral">PEWS not assessed</Badge>;
  const band = classifyPews(score, category3);
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 ${band.tone}`}>
      <span className="tabular-nums">PEWS {score}</span>
      <span>· {band.label}</span>
      {category3 && <span className="cmp-sr-only">, single-category trigger</span>}
    </span>
  );
}

// The full PEWS widget: score, band, the action the band mandates, and when to reassess.
export function PewsWidget({ score, category3 = false, assessedAt }: {
  score: number | null | undefined; category3?: boolean; assessedAt?: string | null;
}) {
  if (score == null) {
    return (
      <div className={cardClass}>
        <p className="text-sm text-gray-500">No PEWS assessment recorded for this patient.</p>
        <p className="text-[11px] text-gray-400 mt-1">Unassessed is an unknown, not a low score.</p>
      </div>
    );
  }
  const band = classifyPews(score, category3);
  return (
    <div className={cardClass}>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold tabular-nums text-gray-900">{score}</p>
        <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${band.tone}`}>{band.label}</span>
      </div>
      <p className="text-xs text-gray-500 mt-0.5">PEWS{category3 ? " · single-category trigger" : ""}</p>
      <p className="text-[11px] text-gray-600 mt-2">{band.action}</p>
      <p className="text-[10px] text-gray-400 mt-1">
        Reassess within {band.reassessMinutes} min
        {assessedAt ? ` · last assessed ${formatDateTime(assessedAt)}` : ""}
      </p>
    </div>
  );
}

// ── Dependency / workload level badges (Ward W1-W5, ICU I1-I5, AACN A1-A5) ─────────────────────────────
const LEVEL_BANDS = { ward: W_LEVELS, icu: I_LEVELS, aacn: A_LEVELS } as const;
const LEVEL_TONE: BadgeTone[] = ["success", "success", "warning", "error", "critical"];

export function LevelBadge({ score, scale, override }: {
  score: number | null | undefined; scale: keyof typeof LEVEL_BANDS; override?: string | null;
}) {
  const bands = LEVEL_BANDS[scale];
  if (score == null) return <Badge tone="neutral">Not assessed</Badge>;
  const band = levelFromBands(score, bands);
  const idx = bands.findIndex(b => b.level === band.level);
  // An override is a clinician's deliberate departure from the computed level, so it is SHOWN as an
  // override rather than silently replacing the number.
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={LEVEL_TONE[idx] ?? "neutral"}>{band.level} · {band.label}</Badge>
      <span className="text-[10px] text-gray-400">{band.ratio}</span>
      {override && override !== band.level && (
        <Badge tone="info" icon="✎">overridden to {override}</Badge>
      )}
    </span>
  );
}

// ── NAS / workload percentage ───────────────────────────────────────────────────────────────────────────
// 100% is one nurse fully occupied by one patient; above that is a genuine over-capacity signal, so the
// bar caps visually while the number keeps telling the truth.
export function WorkloadBar({ percentage, label = "Workload" }: { percentage: number | null | undefined; label?: string }) {
  if (percentage == null) {
    return (
      <div>
        <div className="flex items-center justify-between text-xs mb-0.5">
          <span className="text-gray-700">{label}</span>
          <span className="text-gray-400">not measured</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full" />
      </div>
    );
  }
  const tone = percentage >= 100 ? "critical" : percentage >= 70 ? "warning" : "success";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums" style={{ color: `var(--cmp-text-${tone})` }}>{percentage}%</span>
      </div>
      <Progress value={Math.min(100, percentage)} tone={tone} showValue={false} label={label} />
      {percentage > 100 && <p className="text-[10px] mt-0.5" style={{ color: "var(--cmp-text-critical)" }}>Above one nurse&apos;s capacity</p>}
    </div>
  );
}

// ── Patient card (PUI-004 s8) ───────────────────────────────────────────────────────────────────────────
// op_patients carries NO PHI — `label` is an operational identifier, never a name. The component takes only
// what the store actually holds, so it cannot be handed demographics it has no business rendering.
export function PatientCard({ label, bed, unit, acuity, pews, category3, workloadPct, isolation, href, footer }: {
  label: string; bed?: string | null; unit?: string | null;
  acuity?: string | null; pews?: number | null; category3?: boolean;
  workloadPct?: number | null; isolation?: string | null;
  href?: string; footer?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
          <p className="text-[11px] text-gray-500">
            {bed ? `Bed ${bed}` : "No bed"}{unit ? ` · ${unit}` : ""}
          </p>
        </div>
        <AcuityIndicator level={acuity} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <PewsBadge score={pews} category3={category3} />
        {isolation && isolation !== "none" && (
          <Badge tone="info" icon="⬤">{isolation.replace(/_/g, " ")} precautions</Badge>
        )}
      </div>
      {workloadPct !== undefined && <div className="mt-2"><WorkloadBar percentage={workloadPct} /></div>}
      {footer && <div className="mt-2 pt-2 border-t border-gray-50">{footer}</div>}
    </>
  );
  return href
    ? <Link href={href} className={`${cardClass} block hover:border-gray-300 transition-colors`}>{body}</Link>
    : <div className={cardClass}>{body}</div>;
}

// ── Task card ───────────────────────────────────────────────────────────────────────────────────────────
const TASK_TONE: Record<string, BadgeTone> = { urgent: "critical", high: "error", normal: "neutral", low: "neutral" };

export function TaskCard({ description, priority, status, dueAt, owner, patientLabel, overdue }: {
  description: string; priority?: string | null; status?: string | null;
  dueAt?: string | null; owner?: string | null; patientLabel?: string | null; overdue?: boolean;
}) {
  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-900 min-w-0">{description}</p>
        <span className="flex items-center gap-1 shrink-0">
          {overdue && <Badge tone="critical" icon="▲">Overdue</Badge>}
          {priority && <Badge tone={TASK_TONE[priority] ?? "neutral"}>{priority.replace(/\b\w/g, c => c.toUpperCase())}</Badge>}
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        {patientLabel ? `${patientLabel} · ` : ""}
        {owner ?? "Unassigned"}
        {dueAt ? ` · due ${formatDateTime(dueAt)}` : " · no due date"}
        {status ? ` · ${status.replace(/_/g, " ")}` : ""}
      </p>
    </div>
  );
}

// ── Quality event card ──────────────────────────────────────────────────────────────────────────────────
const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: "critical", high: "error", moderate: "warning", medium: "warning", low: "neutral", informational: "neutral",
};

export function QualityEventCard({ title, severity, status, at, detail, href }: {
  title: string; severity?: string | null; status?: string | null;
  at?: string | null; detail?: string | null; href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 min-w-0">{title}</p>
        {severity && <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{severity.replace(/\b\w/g, c => c.toUpperCase())}</Badge>}
      </div>
      {detail && <p className="text-[11px] text-gray-600 mt-0.5">{detail}</p>}
      <p className="text-[10px] text-gray-400 mt-1">
        {status ? status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : ""}
        {at ? ` · ${formatDateTime(at)}` : ""}
      </p>
    </>
  );
  return href
    ? <Link href={href} className="block border border-gray-100 rounded-lg p-3 hover:border-gray-300 transition-colors">{body}</Link>
    : <div className="border border-gray-100 rounded-lg p-3">{body}</div>;
}

// ── Shift summary widget (PUI-004 s8) ───────────────────────────────────────────────────────────────────
export function ShiftSummary({ window, unit, status, counts, progressPct, note }: {
  window?: string | null; unit?: string | null; status?: string | null;
  counts: { label: string; value: number }[]; progressPct?: number | null; note?: string | null;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Current Shift</span>
        {status && <Badge tone={status === "active" ? "success" : "neutral"}>{status.replace(/\b\w/g, c => c.toUpperCase())}</Badge>}
      </div>
      <p className="text-sm font-semibold text-gray-900 mt-1">
        {window ?? "No shift recorded"}{unit ? ` · ${unit}` : ""}
      </p>
      {counts.length > 0 && (
        <div className="grid gap-1 mt-2 text-center" style={{ gridTemplateColumns: `repeat(${Math.min(counts.length, 4)}, minmax(0, 1fr))` }}>
          {counts.map(c => (
            <div key={c.label}>
              <p className="text-sm font-bold tabular-nums text-gray-900">{c.value}</p>
              <p className="text-[8px] uppercase text-gray-400">{c.label}</p>
            </div>
          ))}
        </div>
      )}
      {progressPct != null && <div className="mt-2"><Progress value={progressPct} showValue={false} label="Shift progress" /></div>}
      {note && <p className="text-[10px] text-gray-500 mt-1">{note}</p>}
    </div>
  );
}
