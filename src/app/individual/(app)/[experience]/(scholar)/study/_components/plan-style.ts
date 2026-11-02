// My Plan (PLP-01..04): the class strings its screens share. Existing tokens only, no hex. 44px targets, the touch minimum on a coarse pointer.
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "pointer-coarse:min-h-[var(--cmp-touch-min)]";
export const primaryBtn = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${touch} ${focusRing}`;
export const secondaryBtn = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${touch} ${focusRing}`;
export const linkBtn = `inline-flex min-h-[44px] items-center text-[14px] font-semibold underline underline-offset-2 ${touch} ${focusRing}`;
export const fieldCls = `block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 ${touch} ${focusRing}`;
export const labelCls = "block text-[13px] font-semibold text-gray-800";
export const hintCls = "mt-0.5 text-[12.5px] text-gray-600";
export const cardCls = "rounded-2xl border border-gray-200 bg-white p-4 sm:p-5";
export const errorCls = "text-[13.5px] font-semibold text-red-800";
export const summaryCls = `inline-flex min-h-[44px] cursor-pointer items-center text-[13.5px] font-semibold text-gray-800 ${touch} ${focusRing}`;
/** A smaller secondary control (still the touch minimum high): the options beside a main action. */
export const quietBtn = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${touch} ${focusRing}`;
/** The small word on a card ("Suggested"). */
export const tagCls = "inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[12.5px] font-semibold text-gray-700";
/** CE-03 compact controls: pills that are small on a fine pointer and the touch minimum on a coarse one. */
const pill = `inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[13.5px] font-semibold disabled:opacity-50 ${touch} ${focusRing}`;
/** Filled with the accent (set with style={{ background: accent }}). */
export const pillPrimary = `${pill} text-white hover:opacity-90`;
export const pillOutline = `${pill} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
/** A square outlined icon button (the calendar's previous / next, the header's calendar). */
export const squareBtn = `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${focusRing}`;
/** One entry of a small menu. */
export const menuItemCls = `flex min-h-10 w-full items-center rounded-lg px-3 py-1.5 text-left text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${touch} ${focusRing}`;
/** The little clock chip beside a row ("10 min"). */
export const whenChipCls = "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[12.5px] font-semibold tabular-nums text-gray-700";
