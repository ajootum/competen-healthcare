/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import {
  POLICIES, POLICY_SCOPE, POLICY_PATH_PREFIX, clampInt, clampSet, clampCatalogues, clampChoice, clampProgrammes, clampOptions, clampLevels, clampSequence, policyPath, type PolicyDef,
} from "@/lib/individual/policy";
import { ChoiceDraft, IntDraft, LevelsDraft, OptionsDraft, PublishBar, RollbackButton, SequenceDraft, SetDraft } from "./_components/PolicyControls";
import LcpdEditor from "./_components/LcpdEditor";
import { LCPD_PATH, REVIEW_LABEL, resolveLcpd } from "@/lib/individual/lcpd-config";

// /super-admin/individual/configuration -- COMPETEN-CONFIG-002 item 6.
//
// The Competen Individual policy, no code. Guarded by hq.individual.config.manage (migration 376), the
// right the Individual Product Administrator appointment holds -- NOT super-admin. Reads only the WCE
// platform tables (migration 076) at the Individual partition, which the plane boundary does not govern.
//
// For every policy it shows what is effective now and since when, where that value came from, the draft,
// and the fixed hard limit with its reason. Below: the published versions (each one restorable) and the
// change trail. It does not show or change the Individual release gate: activation is the owner's alone.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competen Individual policy" };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function describe(def: PolicyDef, settings: any, names: Map<string, string> = new Map()): string {
  if (def.kind === "int") return `${clampInt(def, settings)} ${def.unit}`;
  if (def.kind === "catalogues") {
    const ids = clampCatalogues(def, settings);
    return ids.length ? ids.map(id => names.get(id) ?? "A catalogue no longer shared and published (offers nothing)").join(", ") : def.emptyMeans ?? "None offered (nothing reaches a person until a catalogue is chosen)";
  }
  // JOIN-01: the educational context asked when a person joins Scholar.
  if (def.kind === "programmes") {
    const codes = clampProgrammes(def, settings);
    if (codes === null) return "Every active programme";
    return codes.length ? codes.map(c => names.get(c) ?? `${c} (not an active programme: not offered)`).join(", ") : "None offered (nobody can join Scholar until one is)";
  }
  if (def.kind === "options") {
    const list = clampOptions(def, settings);
    // A long list (every country, by default) is summarised, not printed whole.
    const shown = list.length > 12 ? `${list.slice(0, 12).map(o => o.label).join(", ")} and ${list.length - 12} more` : list.map(o => o.label).join(", ");
    return list.length ? shown : `None (${def.emptyMeans ?? "no institution is asked"})`;
  }
  if (def.kind === "levels") {
    const by = Object.entries(clampLevels(def, settings));
    return by.length ? by.map(([c, l]) => `${names.get(c) ?? c}: ${l.map(x => x.label).join(", ")}`).join(". ") : "None (no level is asked)";
  }
  if (def.kind === "choice") { const v = clampChoice(def, settings); return def.options.find(o => o.value === v)?.label ?? v; }
  if (def.kind === "sequence") return clampSequence(def, settings).map((v, i) => `${i + 1}. ${def.options.find(o => o.value === v)?.label ?? v}`).join("  ");
  const on = clampSet(def, settings);
  return on.length ? def.options.filter(o => on.includes(o.value)).map(o => o.label).join(", ") : "None offered";
}

export default async function IndividualPolicyPage() {
  const ctx = await requireHqCapability("hq.individual.config.manage");
  const admin = ctx.admin;
  const scope = (q: any) => q.eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef);

  const [ovr, ver, aud, cats, progs, lcpdRow] = await Promise.all([
    scope(admin.from("workspace_config_overrides").select("config_path, draft, published, updated_by_name, updated_at")).like("config_path", `${POLICY_PATH_PREFIX}%`),
    scope(admin.from("workspace_config_versions").select("id, note, status, published_by_name, created_at, snapshot")).order("created_at", { ascending: false }).limit(25),
    scope(admin.from("workspace_config_audit").select("action, config_path, actor_name, created_at, new_value")).order("created_at", { ascending: false }).limit(40),
    // S1: the catalogues an allowlist may name -- shared, active, published -- and their layer.
    admin.from("frameworks").select("id, name, competency_layer").is("hospital_id", null).eq("is_active", true).eq("pub_status", "published").order("name"),
    // JOIN-01: the active Scholar programmes (migration 387) that the join may offer and give levels to.
    admin.from("individual_scholar_programme").select("code, label").eq("is_active", true).order("label"),
    // LCPD-01 s11: the Professional Learning and CPD document, one more path in the same scope.
    scope(admin.from("workspace_config_overrides").select("draft, published, updated_by_name")).eq("config_path", LCPD_PATH).maybeSingle(),
  ]);
  const lcpdPublished = resolveLcpd(lcpdRow.data?.published ?? null);
  const lcpdDraft = lcpdRow.data?.draft ? resolveLcpd(lcpdRow.data.draft) : null;
  const lcpdPending = !!lcpdRow.data && !same(lcpdRow.data.draft, lcpdRow.data.published);
  const catalogueOptions = ((cats.data ?? []) as any[]).map(f => ({ value: String(f.id).toLowerCase(), label: f.competency_layer ? `${f.name} (${f.competency_layer})` : `${f.name} (layer not set)` }));
  const programmeOptions = ((progs.data ?? []) as any[]).map(p => ({ value: String(p.code), label: String(p.label) }));
  // One lookup for both: catalogue ids are uuids and programme codes are not, so they cannot collide.
  const catalogueNames = new Map([...catalogueOptions, ...programmeOptions].map(o => [o.value, o.label]));
  const unreadable = !!(ovr.error || ver.error || aud.error);
  const rows = new Map<string, any>((ovr.data ?? []).map((r: any) => [r.config_path, r]));
  const versions: any[] = ver.data ?? [];
  const pending = POLICIES.filter(p => { const r = rows.get(policyPath(p.key)); return r && !same(r.draft, r.published); }).length + (lcpdPending ? 1 : 0);

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
        <p className="mt-1 text-sm text-gray-600">
          The Scholar study programmes themselves, and the catalogues each learns against, are on the{" "}
          <a href="/super-admin/individual/programmes" className="font-semibold underline">Scholar programmes</a> page.
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
          const effective = describe(def, published, catalogueNames);
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
                <div><dt className="text-[12px] font-semibold text-gray-500">Fixed limit</dt><dd className="text-gray-800">{def.kind === "int" ? `${def.min} to ${def.max} ${def.unit}. Default ${def.fallback}.` : def.kind === "catalogues" ? `Shared, active, published catalogues only, at most ${def.max}. Default: ${def.emptyMeans ?? "none"}.` : def.kind === "choice" ? `One of: ${def.options.map(o => o.label).join("; ")}. Default: ${def.options.find(o => o.value === def.fallback)?.label ?? def.fallback}.` : def.kind === "set" ? `Only: ${def.options.map(o => o.label).join(", ")}. Default: ${def.fallback.length === def.options.length ? "all" : def.fallback.length ? def.options.filter(o => def.fallback.includes(o.value)).map(o => o.label).join(", ") : "none"}.` : def.kind === "sequence" ? `Only: ${def.options.map(o => o.label).join(", ")}, in any order. Default: all, in that order.` : def.kind === "options" ? `At most ${def.max}. Default: ${def.fallback ? `${def.fallback.length} listed` : def.emptyMeans ?? "none"}.` : ""} <span className="text-gray-500">{def.limitReason}</span></dd></div>
              </dl>
              {draftDiffers && (
                <p className="mt-3 rounded-lg bg-[var(--cmp-surface-information)] px-3 py-1.5 text-[13px] text-blue-900">
                  Unpublished draft: {describe(def, r.draft, catalogueNames)}{r.updated_by_name ? `, saved by ${r.updated_by_name}` : ""}.
                </p>
              )}
              <div className="mt-3 border-t border-gray-100 pt-3">
                {def.kind === "int"
                  ? <IntDraft policyKey={def.key} label={def.label} unit={def.unit} min={def.min} max={def.max} draft={clampInt(def, r?.draft ?? published)} hasOverride={!!r} />
                  : def.kind === "catalogues"
                    ? <SetDraft policyKey={def.key} legend="Draft: catalogues offered" options={catalogueOptions} draft={clampCatalogues(def, r?.draft ?? published)} hasOverride={!!r} />
                    : def.kind === "choice"
                      ? <ChoiceDraft policyKey={def.key} options={[...def.options]} draft={clampChoice(def, r?.draft ?? published)} hasOverride={!!r} />
                      : def.kind === "programmes"
                      ? <SetDraft policyKey={def.key} legend="Draft: programmes offered" emptyText="No active Scholar programme exists yet." options={programmeOptions}
                          draft={clampProgrammes(def, r?.draft ?? published) ?? programmeOptions.map(o => o.value)} hasOverride={!!r} />
                      : def.kind === "options"
                        ? <OptionsDraft policyKey={def.key} label={`Draft: one ${def.noun ?? "institution"} per line`} max={def.max} draft={clampOptions(def, r?.draft ?? published).map(o => o.label)} hasOverride={!!r} />
                        : def.kind === "levels"
                          ? <LevelsDraft policyKey={def.key} programmes={programmeOptions} max={def.maxPerProgramme} draft={clampLevels(def, r?.draft ?? published)} hasOverride={!!r} />
                          : def.kind === "sequence"
                            ? <SequenceDraft policyKey={def.key} options={[...def.options]} fixed={[...(def.fixed ?? [])]} draft={clampSequence(def, r?.draft ?? published)} hasOverride={!!r} />
                            : <SetDraft policyKey={def.key} options={[...def.options]} draft={clampSet(def, r?.draft ?? published)} hasOverride={!!r} />}
              </div>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="lcpd-h" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="lcpd-h" className="text-[15px] font-bold text-gray-900">Professional Learning & CPD</h2>
        <p className="mt-1 text-[13px] text-gray-600">
          Activity types, reflection templates, which learning can be shared on a Passport, and CPD requirements. In effect now:
          {" "}{lcpdPublished.activityTypes.length} activity types, {lcpdPublished.reflectionTemplates.length} reflection templates, {lcpdPublished.requirements.length} CPD {lcpdPublished.requirements.length === 1 ? "requirement" : "requirements"}
          {lcpdPublished.requirements.length ? ` (${lcpdPublished.requirements.map(r => `${r.label}: ${REVIEW_LABEL[r.reviewStatus].toLowerCase()}`).join("; ")})` : ""}.
          {lcpdPending ? ` An unpublished draft is saved${lcpdRow.data?.updated_by_name ? ` by ${lcpdRow.data.updated_by_name}` : ""}.` : ""}
        </p>
        {lcpdRow.error && <p role="alert" className="mt-2 text-[13px] text-red-700">The Learning & CPD configuration could not be read just now. Nothing is shown rather than a guess.</p>}
        {!lcpdRow.error && <div className="mt-3"><LcpdEditor initial={lcpdDraft ?? lcpdPublished} /></div>}
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
                    return <li key={def.key}><span className="text-gray-500">{def.label}:</span> {e ? describe(def, e.settings, catalogueNames) : `default (${describe(def, null, catalogueNames)})`}</li>;
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
              const what = a.action === "set" ? `saved a draft of ${def?.label ?? a.config_path}: ${def ? describe(def, a.new_value, catalogueNames) : "value"}`
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
