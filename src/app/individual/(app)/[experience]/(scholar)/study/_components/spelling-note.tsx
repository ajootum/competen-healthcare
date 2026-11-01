import type { AnswerSpelling } from "@/lib/individual/scholar/spelling";

// SCHOLAR-LEARN-GAPS-02 item 3: beside a learner's free-text answer echo, how Scholar read it (spelling.ts, deterministic, no
// AI). Display only: the answer is marked and stored exactly as typed, and the note says so.

export function SpellingNote({ spelling, what = "answer", className = "mt-1" }: { spelling?: AnswerSpelling | null; what?: string; className?: string }) {
  if (!spelling || (!spelling.corrections.length && !spelling.needsClarification.length)) return null;
  return (
    <div className={`${className} text-[12px] text-gray-600`}>
      {spelling.corrections.length > 0 && (
        <p className="break-words">Scholar read this as &ldquo;{spelling.display}&rdquo; (corrected from &ldquo;{spelling.original}&rdquo;). Your {what} is marked exactly as you typed it.</p>
      )}
      {spelling.needsClarification.map(q => (
        <p key={`${q.index}-${q.token}`} className="break-words">Did you mean {q.candidates.map(c => `“${c}”`).join(" or ")} instead of &ldquo;{q.token}&rdquo;? Your {what} is left exactly as typed.</p>
      ))}
    </div>
  );
}
