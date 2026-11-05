import { PageHeader } from "../../../../../_components/chrome";
import { SCHOLAR } from "@/lib/individual/experiences";

// SCHOLAR-PERF-01: what shows the moment a Scholar page is opened, while the server builds it. The page's own name, and shapes
// where its content will come. No figures and no records, because nothing has been read yet. The tab bar is not drawn here: the
// real one needs the learner's open study session, and it arrives with the page.

const bar = "rounded-full bg-gray-200/80";
const pulse = "animate-pulse motion-reduce:animate-none";

export function StudyLoading({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div data-study-loading>
      <PageHeader accent={SCHOLAR.accent} eyebrow={eyebrow} title={title} />
      <p role="status" className="sr-only">Loading {title}</p>
      <div aria-hidden className={pulse}>
        <div className="mb-5 flex gap-2 overflow-hidden">
          {[0, 1, 2, 3].map(i => <div key={i} className={`h-10 w-24 shrink-0 ${bar}`} />)}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className={`h-5 w-2/5 ${bar}`} />
            <div className={`mt-3 h-3.5 w-4/5 ${bar}`} />
            <div className={`mt-2 h-3.5 w-3/5 ${bar}`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map(i => (
              <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className={`h-4 w-1/2 ${bar}`} />
                <div className={`mt-3 h-3.5 w-full ${bar}`} />
                <div className={`mt-2 h-3.5 w-3/4 ${bar}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
