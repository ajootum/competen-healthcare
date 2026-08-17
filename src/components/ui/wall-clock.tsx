"use client";

import { HHMM_PATTERN } from "@/lib/practice/practice-time";

// THE 24-HOUR TIME CONTROL. One component, so that eleven screens stop being eleven chances to get it
// wrong.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY NOT type="time". The native picker renders in the OPERATING SYSTEM's locale, so a product that
// speaks the 24-hour clock everywhere else draws "11:00 AM" on any machine set to en-US -- which is
// what the owner saw, twice, on two different screens. The value shape is identical either way (HH:MM),
// so nothing downstream changes: this is a control swap, not a data change.
//
// ⚠ AND WHY NOT type="datetime-local" ANYWHERE, WHICH IS THE SHARPER HALF. Its value is an OFFSETLESS
// string, "2026-08-18T14:30". Written to a timestamptz, Postgres reads it in the connection's zone, so
// a Kampala 14:30 is stored as 14:30 UTC and read back as 17:30. Composed with `new Date(value)`
// instead, it is read in the BROWSER's zone, which is right until the practitioner travels. Neither is
// the practice's zone, which is the only zone the wall clock on the wall was ever in. So a date and a
// time are captured SEPARATELY here and composed by whoever knows the timezone -- the server, or on a
// device with a cached pack, `instantInZone`.
//
// ⚠ type="date" IS FINE AND IS DELIBERATELY NOT BANNED. Its value is unambiguous (YYYY-MM-DD), it
// carries no zone to get wrong, and the native calendar is genuinely the better control -- especially
// on a phone. The ban is about clocks, not about pickers.

export function TimeInput({
  value, onChange, className, placeholder = "09:00", required, disabled, id, name, ariaLabel, title,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <input
      type="text"
      id={id}
      name={name}
      value={value}
      onChange={e => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      aria-label={ariaLabel}
      // ⚠ THE PATTERN IS IMPORTED, NEVER WRITTEN OUT. It and the RegExp that validates the same value
      // in JavaScript are compiled from one string, so they cannot drift apart -- and no screen can
      // reintroduce the eaten-backslash form by copying a slightly wrong one from a neighbour.
      pattern={HHMM_PATTERN}
      placeholder={placeholder}
      // A numeric keypad on a phone, and no autocorrect trying to make a word out of "09:00".
      inputMode="numeric"
      autoComplete="off"
      // The title is BOTH the browser's validation bubble and the hover hint, so it has to state the
      // format in the form the field will accept, with an example. "Invalid input" is what shows
      // without it.
      title={title ?? "24-hour clock, HH:MM -- for example 09:00 or 14:30"}
      // 16px below md or iOS zooms the whole viewport on focus (CPR-MOB-001 s16), and the coarse
      // pointer floor from phase 8 -- this control is small and lands in dense rows.
      className={`${className ?? ""} max-md:text-[16px] max-md:min-h-[var(--cp-touch)] pointer-coarse:min-h-[var(--cp-touch)]`.trim()}
    />
  );
}
