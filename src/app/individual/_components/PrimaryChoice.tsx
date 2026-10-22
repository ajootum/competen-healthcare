"use client";

import { useState } from "react";
import { EXPERIENCES, type ExperienceKey } from "@/lib/individual/experiences";

// The primary-experience choice, used by the welcome (with completeOnboarding) and by Settings. It offers
// ONLY live experiences -- the server refuses anything else (/api/individual/preferences), and offering a
// choice the server will refuse is a form that lies.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export default function PrimaryChoice({ live, initial, completeOnboarding, submitLabel }: {
  live: ExperienceKey[]; initial: ExperienceKey; completeOnboarding: boolean; submitLabel: string;
}) {
  const [choice, setChoice] = useState<ExperienceKey>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const accent = EXPERIENCES[choice].accent;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/individual/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryExperience: choice, completeOnboarding }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "That could not be saved."); return; }
      if (completeOnboarding) { window.location.assign(json.next ?? `/individual/${choice}`); return; }
      setSaved(true);
    } catch {
      setError("That could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {live.length > 1 && (
        <fieldset>
          <legend className="text-[14px] font-semibold text-gray-900">Which experience should open first when you sign in?</legend>
          <p className="mt-0.5 text-[13px] text-gray-600">You can switch between them at any time, and change this later in Settings.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {live.map(key => {
              const x = EXPERIENCES[key];
              const on = key === choice;
              return (
                <label key={key}
                  className={`flex cursor-pointer gap-3 rounded-xl border-2 bg-white p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gray-900 ${on ? "" : "border-gray-200"}`}
                  style={on ? { borderColor: x.accent, background: x.accentSoft } : undefined}>
                  <input type="radio" name="primary" value={key} checked={on} onChange={() => setChoice(key)}
                    className="mt-1 h-4 w-4 shrink-0" style={{ accentColor: x.accent }} />
                  <span>
                    <span className="block text-[14.5px] font-bold" style={{ color: x.accent }}>{x.name}</span>
                    <span className="block text-[13px] text-gray-600">{x.micro}</span>
                    {on && <span className="mt-1 block text-[12px] font-semibold text-gray-800">Opens first</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="text-[13.5px] font-medium text-red-700">{error}</p>}
      {saved && <p role="status" className="text-[13.5px] font-medium text-green-800">Saved. {EXPERIENCES[choice].name} opens first when you sign in.</p>}
      <button type="submit" disabled={busy}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}
        style={{ background: accent }}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
