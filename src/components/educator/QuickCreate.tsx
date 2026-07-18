"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// "+ Create" quick action menu (spec). Entries whose creation workflow exists
// link to it; the rest render muted with a "soon" chip — no dead launches.
// Today the only end-to-end creation path is Bulk Import (CSV); Course and
// Question modules exist but author via import/Supabase until their editors ship.

const ITEMS: { label: string; icon: string; href?: string; note?: string }[] = [
  { label: "Bulk Import (CSV)", icon: "📥", href: "/educator/import", note: "learners & content" },
  { label: "Course",            icon: "📚", href: "/educator/courses", note: "editor pending — manage existing" },
  { label: "Question",          icon: "❓", href: "/educator/questions", note: "editor pending — browse bank" },
  { label: "Assessment",        icon: "📝" },
  { label: "Simulation",        icon: "🧪" },
  { label: "OSCE",              icon: "🩺" },
  { label: "Competency",        icon: "🧩" },
  { label: "Learning Path",     icon: "🛤️" },
  { label: "CPU",               icon: "🎓" },
];

export default function QuickCreate() {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl px-4 py-2.5 transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm leading-none">＋</span> Create
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1">
          {ITEMS.map(item => item.href ? (
            <Link key={item.label} href={item.href} onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-xs text-gray-700 hover:bg-purple-50">
              <span className="w-5 text-center">{item.icon}</span>
              <span className="flex-1 font-medium">{item.label}</span>
              {item.note && <span className="text-[9px] text-gray-300">{item.note}</span>}
            </Link>
          ) : (
            <span key={item.label} title="Creation workflow not built yet"
              className="flex items-center gap-2.5 px-4 py-2 text-xs text-gray-300 cursor-default select-none">
              <span className="w-5 text-center opacity-50">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <span className="text-[8px] font-bold uppercase tracking-wider bg-gray-100 text-gray-400 rounded px-1 py-0.5">soon</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
