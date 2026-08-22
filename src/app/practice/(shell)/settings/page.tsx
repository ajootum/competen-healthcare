import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getConfiguration, listLocations, configurationHistory } from "@/lib/practice/configuration";
import { listFacilities } from "@/lib/practice/facilities";
import { resolvePreferences, configurationChecklist } from "@/lib/practice/preferences";
import { practiceSetup } from "@/lib/practice/setup";
import SettingsConsole from "./SettingsConsole";
import PersonalisationConsole from "./PersonalisationConsole";
import SettingsCards, { type SettingsCard } from "./SettingsCards";
import BillingCard from "./BillingCard";
import { subscriptionState, formatMoney } from "@/lib/practice/subscription-state";
import { gatewayConfig, currencyExponent } from "@/lib/practice/billing-gateway";

// /practice/settings — CPR-SET-004 Personal Settings & Practice Setup.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Separate Personal Settings from Practice Setup" is the whole specification, and the split is real
// rather than cosmetic: personal settings never affect anybody else, practice settings change the
// product for everyone here. The two tabs make that visible before somebody changes something.
//
// PRACTICE SETUP IS NOT DUPLICATED HERE. It has its own workspace at /practice/setup with seventeen
// modules and its own progress; a second copy under a tab would be two screens telling the same story
// and drifting apart. The tab shows what state it is in and sends you there.
//
// ---- WHAT WAS REMOVED, AND WHY IT IS NOT THE SAME AS HIDING A LIMITATION -----------------------------
//
// "Hide all developer placeholders such as 'Not yet wired', feature flags and identifiers."
//
// This page used to print `identifier_policy`, `feature_flags` and `date_format` in a monospace list.
// Those are COLUMN NAMES. A practitioner cannot act on them, they are not a product statement, and they
// were on a settings page in production -- exactly what the specification means. Gone.
//
// What is NOT gone is a plain sentence about something that does not work yet: "restoring from a backup
// is not built" tells somebody not to rely on it, which is a fact about the product rather than about
// the schema. The rule that survives is the one CPR-360 set -- do not render an input that writes to a
// value nothing reads -- and it now needs no list to enforce it, because those inputs were never here.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

 

export const dynamic = "force-dynamic";

const THEME_LABEL: Record<string, string> = {
  light: "Light", dark: "Dark", system: "Match device",
};
const SCALE_LABEL: Record<string, string> = {
  small: "Smaller text", normal: "Normal text", large: "Larger text",
};

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const canManagePractice = hasCapability(ctx, "practice.settings.manage");
  const admin = createAdminClient();

  const { tab } = await searchParams;
  const activeTab = tab === "practice" ? "practice" : "personal";

  const [resolved, checklist, setup, configuration, locations, history, facilities, billing] = await Promise.all([
    resolvePreferences(admin, ctx.workspaceId, ctx.userId),
    configurationChecklist(admin, ctx.workspaceId, ctx.userId),
    practiceSetup(admin, ctx),
    canManagePractice ? getConfiguration(admin, ctx.workspaceId) : Promise.resolve(null),
    canManagePractice ? listLocations(admin, ctx.workspaceId) : Promise.resolve([]),
    canManagePractice ? configurationHistory(admin, ctx.workspaceId) : Promise.resolve([]),
    canManagePractice ? listFacilities(admin, ctx) : Promise.resolve([]),
    subscriptionState(admin, ctx.workspaceId, gatewayConfig() !== null),
  ]);

  // Money is formatted HERE, on the server, against the same exponent table the gateway is charged in --
  // so the price on the button cannot drift from the price Flutterwave receives.
  const prices: Record<string, string | null> = {};
  for (const o of billing.offers) prices[o.planCode] = formatMoney(o.amountMinor, o.currency, currencyExponent);

  const p = resolved.preferences;
  const visibleWidgets = p.dashboardWidgets.filter(w => w.visible).length;
  const notificationsOn = Object.values(p.notificationCategories).filter(Boolean).length;

  // ── THE TEN PERSONAL CATEGORIES ─────────────────────────────────────────────────────────────────
  //
  // Each chip is read from the resolved preferences, so the grid answers most questions without being
  // opened -- which is what "within two clicks" actually requires.
  const cards: SettingsCard[] = [
    {
      key: "appearance", title: "Appearance",
      blurb: "Theme, colours, text size and display preferences.",
      icon: "◑", tone: "bg-violet-100 text-violet-700",
      href: "/practice/settings#appearance",
      chips: [
        { label: THEME_LABEL[p.theme] ?? p.theme },
        { label: p.accent, className: "rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold capitalize text-gray-600" },
        { label: SCALE_LABEL[p.fontScale] ?? p.fontScale },
      ],
      unavailable: null,
    },
    {
      key: "dashboard", title: "Dashboard",
      blurb: "Choose which widgets appear on your command centre and in what order.",
      icon: "▦", tone: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]",
      href: "/practice/settings#dashboard",
      chips: [{ label: `${visibleWidgets} of ${p.dashboardWidgets.length} shown` }],
      // The comp draws drag-and-drop. Ordering here is up/down, which does the same job; saying so is
      // more use than a card that implies a gesture the page does not support.
      unavailable: "Reordering is by move-up and move-down, not dragging.",
    },
    {
      key: "notifications", title: "Notifications",
      blurb: "Choose what you want to be notified about.",
      icon: "◔", tone: "bg-amber-100 text-amber-700",
      href: "/practice/settings#notifications",
      chips: [{ label: `${notificationsOn} categories on` }],
      unavailable: null,
    },
    {
      key: "accessibility", title: "Accessibility",
      blurb: "Larger text and reduced visual noise.",
      icon: "◉", tone: "bg-emerald-100 text-emerald-700",
      href: "/practice/settings#appearance",
      chips: [
        { label: SCALE_LABEL[p.fontScale] ?? p.fontScale },
        ...(p.reduceVisualNoise ? [{ label: "Reduced noise" }] : []),
      ],
      // Named rather than promised: the specification lists six accessibility options and two are built.
      unavailable: "High contrast, colour-blind palettes and a dyslexia font are not built yet.",
    },
    {
      key: "ai", title: "AI Assistant",
      blurb: "How the assistant helps, and what it may read.",
      icon: "✧", tone: "bg-[var(--cp-accent)]/15 text-cyan-700",
      href: "/practice/assistant",
      chips: [{ label: "Consent required", className: "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" }],
      unavailable: null,
    },
    {
      key: "shortcuts", title: "Keyboard Shortcuts",
      blurb: "View and use keyboard shortcuts.",
      icon: "⌨", tone: "bg-[var(--cp-info)]/15 text-[var(--cp-info)]",
      href: "/practice/settings#shortcuts",
      chips: p.shortcutsEnabled
        ? [{ label: "g h" }, { label: "g p" }, { label: "/" }, { label: "+7 more" }]
        : [{ label: "Off" }],
      unavailable: null,
    },
    {
      key: "language", title: "Language & Region",
      blurb: "Date, time and number formats.",
      icon: "⌘", tone: "bg-rose-100 text-rose-700",
      href: "/practice/settings?tab=practice#practice-profile",
      chips: [
        { label: "English" },
        { label: "24-hour", className: "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800" },
      ],
      // Honest: the clock is fixed app-wide and the timezone belongs to the practice, not to a person.
      unavailable: "Times are 24-hour throughout. The timezone is a practice setting, not a personal one.",
    },
    {
      key: "security", title: "Security",
      blurb: "Password, sign-in policy and trusted devices.",
      icon: "⛨", tone: "bg-slate-200 text-slate-700",
      href: "/practice/privacy/security",
      chips: [],
      unavailable: null,
    },
    {
      key: "devices", title: "Devices & Sessions",
      blurb: "See where you are signed in and lock a device out.",
      icon: "▤", tone: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]",
      href: "/practice/privacy/security",
      chips: [],
      unavailable: null,
    },
    {
      key: "export", title: "Backup & Export",
      blurb: "Export what this practice holds about a patient.",
      icon: "↧", tone: "bg-teal-100 text-teal-700",
      href: "/practice/privacy",
      chips: [{ label: "Export" }],
      // The comp draws Export · Import · Reset. Two of those do not exist, and a button that resets a
      // practice to defaults is not one to imply before it is built.
      unavailable: "Import and restore-to-defaults are not built.",
    },
  ];

  const tabClass = (active: boolean) =>
    `flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
      active
        ? "border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.06]"
        : "border-gray-200 bg-white hover:border-gray-300"}`;

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">

        {/* ── Header, with the practice's real setup progress ─────────────────────────────────────
            The comp shows "40% complete". This shows the count it is a percentage OF, for the reason
            the setup hub already gives: on a setup screen a wrong completion figure sends somebody
            live believing they are finished. */}
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-[13px] text-gray-500">
              Manage your personal preferences and configure your practice.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold text-gray-500">Practice setup</p>
              <p className="text-[13px] font-bold text-gray-900">
                {setup.progress.done} of {setup.progress.of} done
              </p>
              <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gradient-to-r from-[var(--cp-primary)] to-[var(--cp-accent)]"
                  style={{ width: `${setup.progress.of === 0 ? 0 : (setup.progress.done / setup.progress.of) * 100}%` }} />
              </div>
            </div>
            <Link href="/practice/setup"
              className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
              Continue setup →
            </Link>
          </div>
        </div>

        {/* ── The two halves ──────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3">
          <Link href="/practice/settings?tab=personal" className={tabClass(activeTab === "personal")}>
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-[16px] text-violet-700">◑</span>
            <span className="min-w-0">
              <span className={`block text-[13px] font-bold ${activeTab === "personal" ? "text-[var(--cp-primary-deep)]" : "text-gray-900"}`}>
                Personal Settings
              </span>
              <span className="block text-[11px] text-gray-500">Yours alone — nobody else sees these.</span>
            </span>
          </Link>
          <Link href="/practice/settings?tab=practice" className={tabClass(activeTab === "practice")}>
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[16px] text-emerald-700">▣</span>
            <span className="min-w-0">
              <span className={`block text-[13px] font-bold ${activeTab === "practice" ? "text-[var(--cp-primary-deep)]" : "text-gray-900"}`}>
                Practice Setup
              </span>
              <span className="block text-[11px] text-gray-500">
                {canManagePractice ? "Changes these for everyone here." : "Managed by whoever holds the permission."}
              </span>
            </span>
          </Link>
        </div>

        {activeTab === "personal" ? (
          <>
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-[15px] font-bold text-gray-900">Personal Settings</h2>
              <p className="mt-0.5 text-[12px] text-gray-500">
                Customise Competen Practice to work the way you do. These follow you between devices and
                change nothing for anyone else.
              </p>
              <div className="mt-4">
                <SettingsCards cards={cards} />
              </div>
            </section>

            {/* The full controls, below the grid. `section=personal` is where every Appearance,
                Dashboard, Notifications and Shortcuts card lands. */}
            <div id="personal">
              <PersonalisationConsole
                preferences={resolved.preferences}
                locked={resolved.locked}
                practice={resolved.practice}
              />
            </div>

            {/* The comp's tip strip. It points at the real setup workspace rather than repeating it. */}
            <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-4">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[16px] text-[var(--cp-primary-deep)]">✧</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-gray-900">Set up your practice</p>
                <p className="text-[11px] leading-relaxed text-gray-600">
                  Some settings belong to the practice rather than to you — locations, availability,
                  booking rules, the registration form.
                  {setup.progress.of - setup.progress.done > 0
                    ? ` ${setup.progress.of - setup.progress.done} still to do.`
                    : " All done."}
                </p>
              </div>
              <Link href="/practice/setup"
                className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                Go to Practice Setup →
              </Link>
            </section>
          </>
        ) : (
          <>
            {/* ── PRACTICE SETUP: the state, and the door. Not a second copy of the hub. ───────── */}
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-[15px] font-bold text-gray-900">Practice Setup</h2>
                <span className="text-[11px] text-gray-500">
                  {setup.progress.done} of {setup.progress.of} configured
                </span>
                <Link href="/practice/setup" className="ml-auto text-[12px] font-semibold text-[var(--cp-primary)] hover:underline">
                  Open the setup workspace →
                </Link>
              </div>
              <p className="mt-0.5 text-[12px] text-gray-500">
                Settings for everyone here, not just for you.
                {configuration ? ` Today is ${configuration.today} — every “overdue”, every day view and every report period is worked out from this clock.` : ""}
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {setup.modules
                  .filter(m => m.state !== "not_built")
                  .map(m => (
                    <li key={m.key}>
                      {m.href ? (
                        <Link href={m.href}
                          className="flex items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/[0.03]">
                          <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px]"
                            style={{ background: `color-mix(in srgb, ${m.hue} 12%, white)`, color: m.hue }}>
                            {m.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[12px] font-semibold text-gray-900">{m.title}</span>
                            <span className={`block text-[10px] ${m.state === "configured" ? "text-emerald-700" : "text-amber-700"}`}>
                              {m.state === "configured" ? "Configured" : "Needs attention"}
                              {m.detail ? ` · ${m.detail}` : ""}
                            </span>
                          </span>
                        </Link>
                      ) : (
                        <div className="flex items-start gap-2.5 rounded-lg border border-gray-100 bg-slate-50/60 px-3 py-2">
                          <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[13px] text-slate-300">
                            {m.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[12px] font-semibold text-gray-500">{m.title}</span>
                            <span className="block text-[10px] text-gray-400">You cannot change this</span>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </section>

            {/* CPR-HFE-001 freezes the sidebar at eleven items, so subscription lives HERE with the other
                practice-wide settings rather than becoming a twelfth nav entry. Rendered for everyone on
                this tab: a practitioner without the manage capability still needs to know whether the
                workspace is paid, and the card says who handles it instead of vanishing. */}
            <BillingCard state={billing} prices={prices} canManage={canManagePractice} />

            {canManagePractice && configuration ? (
              <SettingsConsole
                workspace={configuration.workspace}
                config={configuration.config}
                today={configuration.today}
                locations={locations}
                history={history}
                facilities={facilities}
                canManageLocations={hasCapability(ctx, "practice.locations.manage")}
              />
            ) : (
              <p className="rounded-xl border border-gray-200 bg-white p-4 text-[12px] text-gray-500">
                Practice-wide settings — name, clock, locations — are managed by whoever holds that
                permission here. Your own settings are on the other tab and follow you between devices.
              </p>
            )}
          </>
        )}

        {/* Kept from CPR-360: what is still to do, each line something a reader can go and act on. */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-bold text-gray-900">Set up so far</h2>
            <span className="text-[11px] text-gray-500">{checklist.done} of {checklist.total} done</span>
          </div>
          <ul className="mt-2 grid gap-x-4 sm:grid-cols-2">
            {checklist.items.map(i => (
              <li key={i.key} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5">
                <span aria-hidden className={i.done ? "text-[var(--cmp-text-success)]" : "text-gray-300"}>
                  {i.done ? "✓" : "○"}
                </span>
                <span className="min-w-0">
                  <Link href={i.href} className="block text-[12px] font-semibold text-gray-800 hover:underline">
                    {i.label}
                  </Link>
                  <span className="block text-[10px] text-gray-500">{i.hint}</span>
                </span>
                <span className="sr-only">{i.done ? "done" : "not done"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
