import type { Metadata } from "next";
import { isRegisteredOrigin } from "@/lib/individual/preview/origins";

export const dynamic = "force-dynamic";

// HQ-SCHOLAR-PREVIEW-01. Where a preview lands when it has ended, expired, or its link was used already. It needs no session
// and shows nothing about any learner. The way back to HQ is offered only when the origin is a registered Competen origin
// (origins.ts), so a crafted ?r= cannot turn this page into a redirector or a phishing link.

export const metadata: Metadata = { title: "Preview ended", robots: { index: false, follow: false } };

export default async function PreviewEndedPage({ searchParams }: { searchParams: Promise<{ r?: string | string[] }> }) {
  const { r } = await searchParams;
  const candidate = Array.isArray(r) ? r[0] : r;
  const hq = candidate && isRegisteredOrigin(candidate) ? `${candidate}/super-admin/individual/scholar` : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--cmp-app-bg)] px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-6 text-center sm:p-8">
        <h1 className="text-xl font-bold tracking-tight text-[var(--cmp-app-text)]">This preview has ended</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--cmp-app-text-secondary)]">
          A Scholar preview lasts 60 minutes and can be used from one link, once. Nothing on this page belongs to a real learner.
          Open a new preview from Competen HQ.
        </p>
        {hq ? (
          <a href={hq}
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--cmp-app-text)] px-5 py-2.5 text-[14.5px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cmp-app-text)]">
            Return to HQ
          </a>
        ) : (
          <p className="mt-5 text-[13px] text-[var(--cmp-app-text-secondary)]">You can close this tab and return to Competen HQ.</p>
        )}
      </section>
    </main>
  );
}
