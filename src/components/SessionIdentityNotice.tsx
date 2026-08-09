"use client";

import { useEffect, useSyncExternalStore } from "react";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "YOU WERE SOMEBODY ELSE WHEN THIS TAB OPENED."
//
// ⚠ WHY THIS EXISTS. There is ONE session cookie per origin, so /practice and /super-admin share it.
// Signing in as a second account does not create a second session -- it REPLACES the first, in every tab,
// silently. The practice owner hit this: signed in as the platform account to look at HQ, signed in as
// their practitioner account to walk Practice, then refreshed the HQ tab and was refused. Nothing was
// broken; they had simply stopped being the person the tab was opened by. It read as a fault, and they
// reported it as one.
//
// The platform signup route already documents the same hazard in its own words -- "One session cookie
// exists per origin, so this is not a tab-level surprise: it logs the person out of their real account
// everywhere and hands them the new one."
//
// ⚠ WHY DETECTING AFTERWARDS BEATS WARNING BEFOREHAND, which was the alternative.
//
// A warning on the sign-in screen prevents the loss, which sounds stronger. But it fires only on the
// deliberate path, and it is friction on every legitimate sign-in -- and people click through warnings.
// This fires on ANY identity change: a deliberate sign-in, a shared machine, a resumed lock screen, a
// cookie that is not the one this tab started with. That makes it a detection mechanism rather than a
// courtesy, and it is the reason it was chosen.
//
// ⚠ WHAT IT MUST NEVER DO, AND THE HOLE IT WOULD OTHERWISE OPEN.
//
// It renders the name THIS TAB ALREADY DISPLAYED, remembered by the tab itself. It does NOT send the
// previous user's id anywhere, and nothing looks a name up from an id. A "who was this?" endpoint taking
// a user id would let anybody holding an id learn a person's name -- a disclosure hole opened in the
// course of closing a confusion. The tab is only ever shown back what it already showed.
//
// ⚠ AND IT IS sessionStorage, NOT localStorage. Per tab, and gone when the tab closes. A shared machine
// must not keep a former user's name for the next person who opens the browser.
//
// It renders NOTHING when the identity is unchanged, when nothing was remembered (a fresh tab), or when
// storage is unavailable. Absence is the normal case.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const KEY = "cmp.session.identity";

type Remembered = { id: string; name: string | null };

function read(): Remembered | null {
  try {
    return parse(window.sessionStorage.getItem(KEY));
  } catch {
    // ⚠ Storage can throw (private mode, a blocked origin). A notice nobody can render is not an error
    // worth surfacing -- it just means this tab cannot answer the question.
    return null;
  }
}

/** Raw string -> remembered identity. Total: anything malformed is "nothing was remembered". */
function parse(raw: string | null): Remembered | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Remembered;
    return typeof v?.id === "string" && v.id.length > 0 ? v : null;
  } catch { return null; }
}

/** sessionStorage does not change under this tab: it is written once, on load. Nothing to subscribe to. */
const subscribeNever = () => () => {};

/**
 * Remembers who this tab was opened by. Render once per authenticated page, high in the tree.
 *
 * `userId` is the identifier the SERVER resolved for this request, so the comparison is against the
 * session that actually served the page rather than anything the browser asserted.
 */
export function RememberSessionIdentity({ userId, displayName }: { userId: string; displayName: string | null }) {
  useEffect(() => {
    try {
      const prior = read();
      // ⚠ FIRST WRITE WINS FOR THE LIFE OF THE TAB. Overwriting on every render would mean the tab always
      // agrees with the current session and the change could never be noticed -- the bug this exists to
      // report would erase its own evidence.
      if (!prior) window.sessionStorage.setItem(KEY, JSON.stringify({ id: userId, name: displayName }));
    } catch { /* see read() */ }
  }, [userId, displayName]);
  return null;
}

/**
 * Says so when the person now signed in is not the person this tab was opened by.
 *
 * Renders nothing in every other case, including the one where this tab is the first thing that ran.
 */
export default function SessionIdentityNotice({ userId, displayName }: { userId: string; displayName: string | null }) {
  // ⚠ useSyncExternalStore, NOT setState-in-an-effect. React 19's react-hooks/set-state-in-effect refuses
  // the latter and is right to: it renders once with the wrong answer, then again with the right one.
  //
  // The snapshot is the RAW STRING, deliberately. getSnapshot is compared with Object.is on every render,
  // so returning a freshly-parsed object would be a new reference each time and React would loop forever.
  // A primitive is stable, and the parse happens below where it costs nothing.
  const raw = useSyncExternalStore(
    subscribeNever,
    () => { try { return window.sessionStorage.getItem(KEY); } catch { return null; } },
    () => null,          // server render: a tab that has not run yet remembers nothing
  );

  const prior = parse(raw);
  if (!prior || prior.id === userId) return null;

  return (
    <div className="mx-auto mt-4 max-w-md rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left">
      <p className="text-[13px] font-semibold text-amber-900">You are not the account that opened this tab.</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-amber-900/80">
        This tab was opened by <span className="font-semibold">{prior.name ?? "another account"}</span>, and it is
        now signed in as <span className="font-semibold">{displayName ?? "a different account"}</span>.
        {" "}
        Signing in anywhere on this site replaces the previous session in every tab &mdash; there is one
        sign-in per browser, so the two cannot be held at once.
      </p>
      <p className="mt-2 text-[11.5px] text-amber-900/60">
        To use both at the same time, keep one of them in a separate browser profile or a private window.
      </p>
    </div>
  );
}
