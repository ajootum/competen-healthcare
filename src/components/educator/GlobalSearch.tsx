"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Global educator search (spec: search learners, competencies, courses,
// assessments, simulations, OSCEs). Live entities today: learners,
// competencies, courses, questions — served by /api/educator/search.
// Simulation and OSCE search land when those educator modules exist.

type Results = {
  learners: { id: string; name: string }[];
  competencies: { id: string; name: string }[];
  courses: { id: string; name: string }[];
  questions: { id: string; name: string }[];
};

const GROUPS: { key: keyof Results; label: string; icon: string; href: string }[] = [
  { key: "learners",     label: "Learners",     icon: "👩‍⚕️", href: "/educator/students" },
  { key: "competencies", label: "Competencies", icon: "🧩",  href: "/educator/validations" },
  { key: "courses",      label: "Courses",      icon: "📚",  href: "/educator/courses" },
  { key: "questions",    label: "Questions",    icon: "❓",  href: "/educator/questions" },
];

export default function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/educator/search?q=${encodeURIComponent(term)}`);
        if (res.ok) setResults(await res.json());
      } catch { /* fail-soft: dropdown just stays empty */ }
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const total = results ? GROUPS.reduce((s, g) => s + results[g.key].length, 0) : 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 focus-within:border-purple-400 transition-colors">
        <span className="text-gray-400 text-sm">🔍</span>
        <input
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setOpen(true);
            if (e.target.value.trim().length < 2) setResults(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search learners, competencies, courses, questions…"
          className="w-full text-sm outline-none placeholder:text-gray-300 bg-transparent"
          aria-label="Global search"
        />
        {loading && <span className="text-[10px] text-gray-300 shrink-0">searching…</span>}
      </div>

      {open && q.trim().length >= 2 && results && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto">
          {total === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400">No matches for “{q.trim()}”.</p>
          ) : (
            GROUPS.filter(g => results[g.key].length > 0).map(g => (
              <div key={g.key} className="py-1">
                <p className="px-4 pt-2 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">{g.icon} {g.label}</p>
                {results[g.key].map(item => (
                  <button
                    key={item.id}
                    onClick={() => { setOpen(false); router.push(g.href); }}
                    className="w-full text-left px-4 py-1.5 text-xs text-gray-700 hover:bg-purple-50 truncate"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ))
          )}
          <p className="px-4 py-2 border-t border-gray-50 text-[9px] text-gray-300">
            Simulation and OSCE search arrive with their educator modules.
          </p>
        </div>
      )}
    </div>
  );
}
