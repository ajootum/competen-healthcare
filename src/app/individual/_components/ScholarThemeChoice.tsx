"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCHOLAR_THEME_COOKIE, type ScholarThemeChoice as Choice } from "@/lib/design/scholar-theme";

// SCHOLAR-HFE-COLOR-01: a learner's own choice between the approved Scholar colours and the Calm Teal candidate,
// offered only while HQ's `scholar_theme` policy is preview or calm. Stored in this browser only (a cookie): it is a
// display preference, never a record, and changes nothing about learning, access or AI.

const OPTIONS: { value: Choice; label: string; hint: string }[] = [
  { value: "current", label: "Current Scholar colours", hint: "The approved Scholar theme." },
  { value: "calm", label: "Calm Teal (preview)", hint: "A softer teal with warm accents for suggested steps. A candidate we are testing." },
];

/** Outside the component: a browser-only preference write, not React state. */
function storeChoice(v: Choice) {
  document.cookie = `${SCHOLAR_THEME_COOKIE}=${v}; path=/individual; max-age=31536000; samesite=lax`;
}

export default function ScholarThemeChoice({ current }: { current: Choice }) {
  const router = useRouter();
  const [value, setValue] = useState<Choice>(current);

  function choose(v: Choice) {
    setValue(v);
    storeChoice(v);
    router.refresh();
  }

  return (
    <fieldset className="mt-3">
      <legend className="sr-only">Scholar colours</legend>
      <div className="flex flex-col gap-2">
        {OPTIONS.map(o => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 has-[:checked]:border-[var(--cmp-theme-accent)] has-[:checked]:bg-[var(--cmp-theme-soft)] pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="radio" name="scholar-theme" value={o.value} checked={value === o.value} onChange={() => choose(o.value)}
              className="mt-1 h-4 w-4 accent-[var(--cmp-theme-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900" />
            <span>
              <span className="block text-[14px] font-semibold text-gray-900">{o.label}{value === o.value ? <span className="sr-only"> (selected)</span> : null}</span>
              <span className="block text-[13px] text-gray-600">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
