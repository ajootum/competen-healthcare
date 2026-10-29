// Points a reviewer or author may want to look at, read from a competency's criteria themselves (owner, 29 Oct 2026).
// Never a judgement about the clinical content: repeated wording, and components with no criteria.

/** Pure: what a reviewer may want to look at -- read from the content itself, never a judgement about it. */
export function checksFor(criteria: { component: string | null; text: string }[], components: Record<string, string>): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  criteria.forEach((c, i) => {
    const k = `${c.component ?? ""}\u0000${c.text.trim().toLowerCase()}`;
    if (seen.has(k)) out.push(`Criterion ${i + 1} repeats criterion ${seen.get(k)! + 1} word for word.`); else seen.set(k, i);
  });
  if (criteria.length) for (const [code, label] of Object.entries(components)) if (!criteria.some(c => c.component === code)) out.push(`No ${label} criteria are recorded.`);
  if (!criteria.length) out.push("No assessment criteria are recorded.");
  return out;
}
