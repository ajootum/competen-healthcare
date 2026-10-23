/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { POLICIES, POLICY_SCOPE, POLICY_PATH_PREFIX, clampInt, clampSet, policyPath, type PolicyDef } from "@/lib/individual/policy";
import { IntDraft, PublishBar, RollbackButton, SetDraft } from "./_components/PolicyControls";

// /super-admin/individual/configuration -- COMPETEN-CONFIG-002 item 6.
//
// The Competen Individual policy, no code. Guarded by hq.individual.config.manage (migration 376), the
// right the Individual Product Administrator appointment holds -- NOT super-admin. Reads only the WCE
// platform tables (migration 076) at the Individual partition, which the plane boundary does not govern.
//
// For every policy it shows what is effective now and since when, where that value came from, the draft,
// and the fixed hard limit with its reason. Below: the published versions (each one restorable) and the
// change trail. It does not show or change individual_app: activation is the owner's alone.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competen Individual policy" };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function describe(def: PolicyDef, settings: any): string {
  if (def.kind === "int") return `${clampInt(def, settings)} ${def.unit}`;
  const on = clampSet(def, settings);
  return on.length ? def.options.filter(o => on.includes(o.value)).map(o => o.label).join(", ") : "None offered";
}

export default async function IndividualPolicyPage() {
  const ctx = await requireHqCapability("hq.individual.config.manage");
  const admin = ctx.admin;
  const scope = (q: any) => q.eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef);

  const [ovr, ver, aud] = await Promise.all([
    scope(admin.from("workspace_config_overrides").select("config_path, draft, published, updated_by_name, updated_at")).like("config_path", `${POLICY_PATH_PREFIX}%`),
    scope(admin.from("workspace_config_versions").select("id, note, status, published_by_name, created_at, snapshot")).order("created_at", { ascending: false }).limit(25),
    scope(admin.from("workspace_config_audit").select("action, config_path, actor_name, created_at, new_value")).order("created_at", { ascending: false }).limit(40),
  ]);
  const unreadable = !!(ovr.error || ver.error || aud.error);
  const rows = new Map<string, any>((ovr.data ?? []).map((r: any) => [r.config_path, r]));
  const versions: any[] = ver.data ?? [];
  const pending = POLICIES.filter(p => { const r = rows.get(policyPath(p.key)); return r && !same(r.draft, r.published); }).length;

  // Effective since: the oldest version in the unbroken run (newest first) that published the current value.
  const since = (path: string, published: any): string | null => {
    let at: string | null = null;
    for (const v of versions) {
      const e = (v.snapshot ?? []).find((s: any) => s.config_path === path);
      if (!e || !same(e.settings, published)) break;
      at = v.created_at;
    }
    return at;
  };

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Individual</p>
        <h1 className="text-xl font-bold text-gray-900">Individual policy</h1>
        <p className="mt-1 text-sm text-gray-600">
          Limits and options for Competen Scholar and Competen Professional. Save a draft, then publish: a value takes effect when
          its version is published. Every limit has a fixed range that this page cannot change.
        </p>
        {/* Owner ruling (CONFIG-002, 2026-10-23): policy takes effect upon governed publication, with version
            and audit history. Scheduled effective dates were deferred (no migration 377), and legal effective
            dates are a separate matter, not this page. */}
        <p className="mt-2 rounded-lg border border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] px-3 py-2 text-[13px] text-blue-900">
          A change takes effect when it is published. Each version below records who published it and when.
        </p>
      </header>

      {unreadable && (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The policy store could not be read just now. Products are using their defaults. Nothing below can be trusted until this page loads cleanly.
        </p>
      )}

      <section aria-labelledby="pol-h" className="space-y-3">
        <h2 id="pol-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Policies</h2>
        {POLICIES.map(def => {
          const path = policyPath(def.key);
          const r = rows.get(path);
          const published = r?.published ?? null;
          const effective = describe(def, published);
          const raw = def.kind === "int" ? Number(published?.value) : null;
          const clamped = def.kind === "int" && published != null && Number.isFinite(raw) && clampInt(def, published) !== raw;
          const source = published == null
            ? "Default. No value has been published."
            : clamped ? `Clamped to the fixed limit. The stored value was ${raw}.` : "Published.";
          const at = published != null ? since(path, published) : null;
          const draftDiffers = r && !same(r.draft, r.published);
          return (
            <article key={def.key} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-bold text-gray-900">{def.label}</h3>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[12px] font-semibold text-gray-700">{def.product}</span>
              </div>
              <p className="mt-1 text-[13px] text-gray-600">{def.help}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] md:grid-cols-2">
                <div><dt className="text-[12px] font-semibold text-gray-500">Effective now</dt><dd className="font-semibold text-gray-900">{effective}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Source</dt><dd className="text-gray-800">{source}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Effective since</dt><dd className="text-gray-800">{published == null ? "Not applicable: the default has always applied" : at ? fmt(at) : "Not recorded in the recent versions"}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Fixed limit</dt><dd className="text-gray-800">{def.kind === "int" ? `${def.min} to ${def.max} ${def.unit}. Default ${def.fallback}.` : `Only: ${def.options.map(o => o.label).join(", ")}. Default: all.`} <span className="text-gray-500">{def.limitReason}</span></dd></div>
              </dl>
              {draftDiffers && (
                <p className="mt-3 rounded-lg bg-[var(--cmp-surface-information)] px-3 py-1.5 text-[13px] text-blue-900">
                  Unpublished draft: {describe(def, r.draft)}{r.updated_by_name ? `, saved by ${r.updated_by_name}` : ""}.
                </p>
              )}
              <div className="mt-3 border-t border-gray-100 pt-3">
                {def.kind === "int"
                  ? <IntDraft policyKey={def.key} label={def.label} unit={def.unit} min={def.min} max={def.max} draft={clampInt(def, r?.draft ?? published)} hasOverride={!!r} />
                  : <SetDraft policyKey={def.key} options={[...def.options]} draft={clampSet(def, r?.draft ?? published)} hasOverride={!!r} />}
              </div>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="pub-h" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="pub-h" className="text-[15px] font-bold text-gray-900">Publish</h2>
        <p className="mt-1 text-[13px] text-gray-600">Publishing makes every saved draft effective at once and records them as one version.</p>
        <div className="mt-3"><PublishBar pending={pending} /></div>
      </section>

      <section aria-labelledby="ver-h" className="space-y-2">
        <h2 id="ver-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Versions</h2>
        {versions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-600">No version has been published. Every policy is at its default.</p>
        ) : (
          <ol className="space-y-2">
            {versions.map((v, i) => (
              <li key={v.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-semibold text-gray-900">{i === 0 ? "Current version" : "Earlier version"} · effective {fmt(v.created_at)}</p>
                    <p className="text-[12.5px] text-gray-600">Published by {v.published_by_name ?? "an unnamed account"}{v.note ? ` · “${v.note}”` : ""}</p>
                  </div>
                  {i > 0 && <RollbackButton versionId={v.id} when={fmt(v.created_at)} />}
                </div>
                <ul className="mt-2 grid gap-1 text-[13px] text-gray-700 md:grid-cols-2">
                  {POLICIES.map(def => {
                    const e = (v.snapshot ?? []).find((s: any) => s.config_path === policyPath(def.key));
                    return <li key={def.key}><span className="text-gray-500">{def.label}:</span> {e ? describe(def, e.settings) : `default (${describe(def, null)})`}</li>;
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="aud-h" className="space-y-2">
        <h2 id="aud-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Change trail</h2>
        {(aud.data ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-600">No change has been made yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {(aud.data ?? []).map((a: any, i: number) => {
              const def = POLICIES.find(p => policyPath(p.key) === a.config_path);
              const what = a.action === "set" ? `saved a draft of ${def?.label ?? a.config_path}: ${def ? describe(def, a.new_value) : "value"}`
                : a.action === "reset" ? `set ${def?.label ?? a.config_path} back to its default`
                : a.action === "publish" ? "published a version"
                : "restored an earlier version";
              return <li key={i} className="px-4 py-2 text-[13px] text-gray-700"><span className="text-gray-500">{fmt(a.created_at)}</span> · {a.actor_name ?? "An unnamed account"} {what}</li>;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
