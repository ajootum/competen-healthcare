import { minorToMajor } from "@/lib/commerce/gateway";
import { LEARNING_OFF } from "@/lib/learning/policy";

// Shared server-rendered pieces of the Learning HQ pages.

export function Off() {
  return <div className="max-w-3xl"><h1 className="text-xl font-bold text-gray-900">Competen Learning</h1><p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{LEARNING_OFF} It opens when the platform flag learning_app is switched on, after migrations 460 to 464 are applied here.</p></div>;
}

export function Alert({ text }: { text: string }) {
  return <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">{text} Nothing is shown rather than a partial list.</p>;
}

export function Header({ eyebrow = "Competen Holdings · Competen Learning", title, intro }: { eyebrow?: string; title: string; intro: string }) {
  return (
    <header>
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">{eyebrow}</p>
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 text-sm text-gray-600">{intro}</p>
    </header>
  );
}

export const money = (minor: number, currency: string) => `${currency} ${(minorToMajor(minor, currency) ?? minor).toLocaleString("en-GB")}`;
export const when = (t: string | null) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
