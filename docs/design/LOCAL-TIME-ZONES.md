# Local time zones: design note

Owner question, 6 Nov 2026: can times change automatically depending on where the user logs in from?

**Answer: yes, for times that are about the reader. Not for times that belong to a place or a record.**
This change builds the route and converts Scholar first, behind `scholar_reader_time_zone` (default off).
No migration is needed.

## Which zone a reader gets

Pure rule: `resolveReaderClock` in `src/lib/datetime.ts`. The first valid answer wins.

| Order | Source | Where it lives | Why here |
|---|---|---|---|
| 1 | The reader's own choice | `user_preferences.timezone` (migration 164) | An explicit choice beats any guess |
| 2 | This device's zone | Cookie `cmp_reader_tz`, set by the browser from `Intl` | A VPN or mobile carrier does not move it |
| 3 | Network estimate | `x-vercel-ip-timezone` | First page only, before the browser has reported |
| 4 | Africa/Kampala | Constant | The product's home zone |

**Changed from the brief: the detected zone is not saved to `user_preferences.timezone`.**
The code argues against it in three ways:

- Migration 164 defines NULL as "not chosen". A detected value would look like a choice.
- A saved detection would beat the device from then on, so a learner who travels would stay on the old zone.
- Each write adds a row to `user_preference_audit`, and would build a server-side record of where a person has been.

So the column holds only a choice the person made. Detection stays in a cookie on their device.
Reads ignore a stored value that is not a real zone, because the column has never validated it.
`validateWrite` now refuses a new invalid zone.

`pw_prefs.timezone` (PW-012, the old cookie) is shown on `/dashboard/preferences` and no formatter reads it. This
design leaves it alone.

## Server rendering

Most Scholar pages render on the server, and the server cannot see the device. The sequence is:

1. The Scholar layout resolves the clock with `readerClock(ctx)` and hands it to `ReaderClockProvider`.
2. Client components read it with `useReaderClock()`, so the server and browser format with the same zone. This is
   what prevents a hydration mismatch. Formatting never uses the runtime's zone while the clock is on.
3. Server pages call `readerClock(ctx)` themselves. It is cached per request.
4. After mount, the provider compares the device zone with the cookie. If they differ it writes the cookie and, unless
   the person has chosen a zone, refreshes the route once.

The refresh runs only when the cookie really changed. Blocked cookies, or a zone the server does not recognise, cannot
cause a refresh loop.

Limits a reader may see:

- The very first page uses the network estimate for a moment before the refresh.
- A privacy browser that reports UTC gets UTC, labelled as UTC. The reader can choose a zone in Settings.

## Which times follow the reader

| Time | Follows reader? | Why |
|---|---|---|
| When I did something (saved, answered, started, submitted) | **Yes** | It is about me, read on my clock |
| Calendar days: exam date, plan day, due date, month | **No** | Never an instant. "6 Nov" stays 6 Nov everywhere. A bare `YYYY-MM-DD` is never shifted, even if passed by mistake |
| Scholar streak, "today", study days, plan day | **No** | Stays on `learnerTimeZone`, unchanged. Changing the display must not change anybody's count |
| Practice and clinic schedules, encounters, shifts | **No** | Practice's clock (CPR-140, CPR-300). Two staff must read the same time, which is a clinical safety matter |
| Stored times and audit trails | **No** | Stored in UTC. Only their display may change, surface by surface |
| Printed or shared documents, passports, certificates | **No** | The reader of a document is not the signed-in person. It needs its own stated zone. Scholar's printable assessment report stays as it was for this reason |
| HQ operational screens | **Both** | The record's stored time or an agreed HQ zone, plus the reader's. Designed when that slice is reached |
| Emails and notifications | **Not yet** | No page is open at send time, so a saved choice is the only source |

## Labels

Every time of day carries its zone, such as `23:22 EAT`. A date alone does not.

`Intl` does not give this: en-GB prints `GMT+3` for Kampala, and the name depends on the engine's data. The server and
a browser could disagree. So the label comes from a short table of names, and the name is used only if the zone's
real offset at that moment matches it. Otherwise it reads `UTC+5:30`. A wrong name can never appear, even if a country
changes its offset.

## With the policy off

`readerClock` returns null. `formatForReader` then gives exactly what the site gave before, including the old zone that
site used, and nothing reads a preference or sets a cookie. Tests pin this to the old expressions.

One deliberate difference: a date that cannot be read now shows nothing instead of "Invalid Date". These are stored
timestamps, so it should not arise.

## Order of conversion

Do not convert the ~720 calls at once. `src/lib/datetime.scholar-census.test.ts` fails if a Scholar file formats a new
time outside this route, and lists what is left.

1. **This change:** Scholar pages and client components, including every Scholar screen that shows a time of day.
2. **After the Scholar coordinated release merges:** the Scholar server parts those branches are editing, or that need
   a prop passed down (`saved-library-view`, `notebook-view`, `apply-parts`, `evaluate-parts`, `monthly-progress`,
   `progress-view`, `library-rows`, `study-home-model`).
3. **Scholar text built in `src/lib`:** `learn-search`, `global-search`, `library-organise`, `saved-library`.
4. **Professional.** Same reader-owned pattern, its own policy.
5. **Shared signed-in surfaces:** notifications, My Profile, account security.
6. **HQ, showing both zones.** Needs an agreed HQ zone first.
7. **Practice and Enterprise:** only reader-owned times such as "my last sign-in". Practice events stay on the
   practice's clock.

## For the owner to decide later

These do not block this change, because the policy is off.

- **When to switch it on.** Recommended: after step 3 above. Before then, a record can show two different dates for
  about three hours around midnight. For example, an evaluation's own page follows the reader while its row in a list
  (`evaluate-parts`) does not yet.
- **Privacy wording.** The draft privacy notice (`docs/legal/drafts/02-holdings-privacy-notice.md`, section 11) says
  Competen uses strictly necessary authentication and security cookies, and asks for a cookie inventory. This cookie is
  a functional preference and holds a zone name, which is coarse location. It is not sent anywhere else. Add it to the
  inventory and wording before switching on.
- **A lock set by a hospital.** A person's choice is one setting per person (migration 164), so a value saved in the
  unit-manager personalisation screen also applies in Scholar. A `pref_policies` lock refuses a new save with its
  reason, but a value saved before the lock still applies in Scholar, which is a separate product. Leave as it is
  unless a hospital asks for otherwise.
- **Streak on a VPN.** `learnerTimeZone` follows the IP address, so a VPN can already move a learner's "today". Display
  now avoids this and the streak does not. Fixing it means fixing each study day when it is recorded, which is a
  separate piece of work.
