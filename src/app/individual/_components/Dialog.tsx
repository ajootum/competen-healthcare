"use client";

import { createContext, useContext, useEffect, useRef } from "react";

// A trigger and the native <dialog> it opens (Scholar HFE redesign). The dialog's content is ALWAYS in the
// document, closed, so a server-rendered panel inside it (the upload form, the consent notice) is still in
// the page's HTML and works as before once opened. `hash`: the dialog also opens when the URL's fragment
// names it, so an existing #upload link lands on the open upload form.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export function DialogButton({ label, className, style, title, hash, children }: {
  label: React.ReactNode; className?: string; style?: React.CSSProperties; title: string; hash?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!hash) return;
    const check = () => { if (window.location.hash === `#${hash}` && !ref.current?.open) ref.current?.showModal(); };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [hash]);
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} aria-label={title}
        onClick={e => { if (e.target === ref.current) ref.current?.close(); }}
        className="cmp-dialog m-auto w-[92%] max-w-[650px] rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-[0_20px_80px_#172b3d30] backdrop:bg-[#152c4055]">
        <div className="max-h-[85vh] overflow-y-auto p-6 sm:p-7">
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}
            className={`float-right ml-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] font-semibold hover:bg-gray-50 ${focusRing}`}>✕</button>
          {children}
        </div>
      </dialog>
    </>
  );
}

// ── THE SHELL'S PAGE ACTION ── the control at the right of every page heading ─────────────────────────
// The experience layout supplies it (Scholar: the AI help switch, read from the person's consent there) and
// PageHeader renders it, so a page does not have to load it. Nothing is supplied: nothing is rendered.

const ShellActionContext = createContext<React.ReactNode>(null);

export function ShellActionProvider({ action, children }: { action: React.ReactNode; children: React.ReactNode }) {
  return <ShellActionContext.Provider value={action}>{children}</ShellActionContext.Provider>;
}

export function ShellAction() {
  const action = useContext(ShellActionContext);
  return action ? <div className="shrink-0">{action}</div> : null;
}
