"use client";

import { useState } from "react";
import Link from "next/link";

// Quick Create (Studio UX spec §8) — begin authoring from anywhere,
// no deep menu navigation.

const TARGETS = [
  { label: "Clinical Framework", icon: "🏛️", href: "/super-admin/content" },
  { label: "CPU", icon: "🏥", href: "/super-admin/content" },
  { label: "Competency", icon: "🪪", href: "/super-admin/content" },
  { label: "Skill", icon: "✋", href: "/super-admin/studio/skills" },
  { label: "Checklist", icon: "☑️", href: "/super-admin/studio/checklists" },
  { label: "Question Bank", icon: "❓", href: "/super-admin/studio/questions" },
  { label: "Learning Resource", icon: "📚", href: "/admin/resources" },
  { label: "Policy", icon: "📄", href: "/super-admin/policy-manager" },
  { label: "Quality Object", icon: "🛡️", href: "/admin/quality" },
];

export default function QuickCreate() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
        + Create ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 w-52">
            {TARGETS.map(t => (
              <Link key={t.label} href={t.href} onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-teal-800 transition-colors">
                <span>{t.icon}</span>{t.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
