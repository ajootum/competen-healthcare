import Link from "next/link";
import type { ReactNode } from "react";
import { LearningIcon } from "@/components/ui/scholar-learning";

// COMPETEN UNIVERSAL SEARCH STANDARD: the one search box. The same icon, words, height and scope line on every page, so a learner
// does not have to learn each one. PageSearch is a plain form: the words stay in the address, so opening a result and coming back
// keeps them, and it works before any script has loaded. PageSearchInput is the same field for a list filtered in the browser.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const fieldCls = `block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-3 text-[15px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const buttonCls = `inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-[var(--learn-ink)] bg-[var(--learn-ink)] px-4 text-[14px] font-semibold text-[var(--learn-surface)] hover:opacity-90 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const clearCls = `inline-flex min-h-[32px] items-center rounded font-semibold text-[var(--learn-ink)] underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function FieldIcon() {
  return <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><LearningIcon name="search" className="h-[18px] w-[18px]" /></span>;
}

export function PageSearch({ scope, action, name = "q", value, placeholder, hidden = {}, clearHref, className = "mb-4", extra, children }: {
  /** What this box searches, from the search registry. */
  scope: string;
  action: string;
  name?: string;
  value?: string | null;
  placeholder: string;
  hidden?: Readonly<Record<string, string | null | undefined>>;
  /** Shown with words in the box. */
  clearHref?: string;
  className?: string;
  /** Anything that must sit inside the form beside the field, such as the search history key. */
  extra?: ReactNode;
  /** Filters, inside the form. */
  children?: ReactNode;
}) {
  return (
    <form method="get" action={action} role="search" aria-label={scope} className={`cmp-learn-key ${className}`} data-page-search>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {extra}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <FieldIcon />
          <input type="search" name={name} defaultValue={value ?? ""} maxLength={200} autoComplete="off" aria-label={scope} placeholder={placeholder} className={fieldCls} />
        </div>
        <button type="submit" className={buttonCls}>Search</button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-gray-700">
        <span>{scope}</span>
        {value && clearHref && <Link href={clearHref} className={clearCls}>Clear search</Link>}
      </p>
      {children}
    </form>
  );
}

/** The same field, for a list filtered in the browser as the learner types. */
export function PageSearchInput({ scope, value, onChange, placeholder, inputRef, disabled = false, resultNote }: {
  scope: string; value: string; onChange: (v: string) => void; placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>; disabled?: boolean;
  /** "3 of 12 shown", read out as it changes. */
  resultNote?: string | null;
}) {
  return (
    <div className="cmp-learn-key min-w-0 flex-1" data-page-search>
      <div className="relative">
        <FieldIcon />
        <input ref={inputRef} type="search" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} autoComplete="off" aria-label={scope} placeholder={placeholder} className={`${fieldCls} disabled:opacity-60`} />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-gray-700">
        <span>{scope}</span>
        {resultNote && <span role="status">{resultNote}</span>}
        {value && <button type="button" onClick={() => onChange("")} className={clearCls}>Clear search</button>}
      </p>
    </div>
  );
}
