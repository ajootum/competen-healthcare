import type { ReactNode } from "react";

// SCHOLAR-PERF-02: part of a page that takes longer to read than the rest. The page shows without it, and it arrives in the same
// response when it is ready: use inside <Suspense fallback={<SectionLoading />}>. The promise is started by the page, so its reads
// begin at once and not when React reaches this point.

export async function Deferred({ content }: { content: Promise<ReactNode> }) {
  return <>{await content}</>;
}

/** Shapes where the section will come. No words but what a screen reader needs, and no figures, because nothing has been read yet. */
export function SectionLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  const bar = "rounded-full bg-gray-200/80";
  return (
    <div data-section-loading className="mb-6">
      <p role="status" className="sr-only">{label}</p>
      <div aria-hidden className="animate-pulse space-y-3 rounded-2xl border border-gray-200 bg-white p-5 motion-reduce:animate-none">
        <div className={`h-4 w-1/3 ${bar}`} />
        {Array.from({ length: rows }, (_, i) => <div key={i} className={`h-3.5 ${i % 2 ? "w-2/3" : "w-5/6"} ${bar}`} />)}
      </div>
    </div>
  );
}
