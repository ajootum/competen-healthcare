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
