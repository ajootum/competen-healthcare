"use client";

// HQ-SCHOLAR-PREVIEW-01. The button that opens a Scholar preview in a NEW TAB: a plain form POST to the HQ route, which
// answers 303 to the preview host. A form, not a fetch, so the browser follows the redirect to another origin by itself and
// the HQ page is never navigated away. Testing mode asks for a confirmation first, because in that mode actions are real
// (on the sandbox learner).

export default function PreviewLauncher({ mode, label, confirmText, tone = "primary" }: {
  mode: "read_only" | "testing"; label: string; confirmText?: string; tone?: "primary" | "amber";
}) {
  const cls = tone === "amber"
    ? "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
    : "border-[var(--cmp-app-text)] bg-[var(--cmp-app-text)] text-white hover:opacity-90";
  return (
    <form method="post" action="/api/hq/individual/scholar-preview" target="_blank" rel="noopener"
      onSubmit={e => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}>
      <input type="hidden" name="mode" value={mode} />
      <button type="submit"
        className={`inline-flex min-h-[40px] items-center justify-center rounded-xl border px-5 py-2 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${cls}`}>
        {label}
      </button>
    </form>
  );
}
