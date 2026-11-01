import { presentQuestion, type QBlock } from "@/lib/knowledge/question-present";

// SQIE-LIBRARY-GAPS-01. A library question as its reviewer reads it: the fields of its format in words, the key marked in
// words (never by colour alone), the rubric, the marking rule and the declared source rights. A server component: it shows,
// it decides nothing. A legacy single best answer question, or content it cannot read, shows the raw view it always had.

const H = ({ children }: { children: React.ReactNode }) => <p className="font-semibold text-gray-700">{children}</p>;

function Block({ b }: { b: QBlock }) {
  switch (b.kind) {
    case "text": return <div><H>{b.heading}</H><p className="whitespace-pre-wrap">{b.text}</p></div>;
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return <div><H>{b.heading}</H><L className={`ml-5 ${b.ordered ? "list-decimal" : "list-disc"}`}>{b.items.map((x, i) => <li key={i}>{x}</li>)}</L></div>;
    }
    case "options": return (
      <div><H>{b.heading}</H>
        <ul className="ml-5 list-[upper-alpha]">{b.items.map((o, i) => <li key={i}>{o.text}{o.key && <strong className="ml-1.5 rounded border border-teal-600 bg-teal-50 px-1 text-[11.5px] text-teal-950">Correct answer</strong>}</li>)}</ul>
      </div>
    );
    case "pairs": return (
      <div><H>{b.heading}</H>
        <ul className="ml-5 list-disc">{b.items.map((p, i) => <li key={i}>{p.prompt} <span aria-label="matches" className="text-gray-600">matches</span> <strong>{p.match || "(no match written)"}</strong></li>)}</ul>
      </div>
    );
    case "parts": return (
      <div><H>{b.heading}</H>
        <ol className="space-y-1.5">{b.items.map((p, i) => (
          <li key={i} className="rounded border border-gray-200 bg-white p-2">
            <p><strong>{p.label}</strong>{p.marks !== null && <span className="text-gray-600"> · {p.marks} {p.marks === 1 ? "mark" : "marks"}</span>}</p>
            <p className="whitespace-pre-wrap">{p.prompt}</p>
            {p.accepted.length > 0 && <><p className="font-semibold text-gray-700">Accepted answers</p><ul className="ml-5 list-disc">{p.accepted.map((a, j) => <li key={j}>{a}</li>)}</ul></>}
            {p.rubric.map((r, j) => <Block key={j} b={r} />)}
          </li>
        ))}</ol>
      </div>
    );
  }
}

export function QuestionView({ content }: { content: unknown }) {
  const q = presentQuestion(content);
  if (!q) return <pre tabIndex={0} aria-label="Stored content" className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[12.5px] text-gray-900">{JSON.stringify(content, null, 2)}</pre>;
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-[12.5px] text-gray-900">
      <dl className="grid gap-0.5 md:grid-cols-2">
        <div><dt className="inline font-semibold text-gray-700">Format: </dt><dd className="inline">{q.formatLabel}</dd></div>
        {q.markingLabel && <div><dt className="inline font-semibold text-gray-700">Marking: </dt><dd className="inline">{q.markingLabel}</dd></div>}
      </dl>
      {q.blocks.map((b, i) => <Block key={i} b={b} />)}
      <div>
        <H>Source rights</H>
        <p>{q.source.label}{!q.source.declared && <span className="text-gray-600"> (no source was declared for this version)</span>}</p>
        {q.source.lines.length > 0 && <ul className="ml-5 list-disc">{q.source.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </div>
    </div>
  );
}
