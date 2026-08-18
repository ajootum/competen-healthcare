import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §11 — DOCUMENTS & TEMPLATES.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE ONE DOMAIN WHOSE ARTEFACTS LEAVE THE PRODUCT. A booking rule is internal; an issued document is
// printed, emailed, filed by a patient and produced later as evidence of what a clinician wrote. That
// changes what a configuration change means: §11 requires template content and versioning to preserve
// the integrity of documents ALREADY ISSUED, which is the same rule the practitioner-number format
// already implements on the Defaults page — change the shape, never rewrite what was issued.
//
// ⚠ AND §31's NON-GOALS BITE HARDEST HERE. "Not an unrestricted database/admin editor" plus §11's "do
// not store executable/untrusted template logic without sandboxing and validation": a template editor
// is the one configuration surface that can smuggle executable content into a document generator. This
// build offers no template editing, which resolves the question by not opening it.

export const dynamic = "force-dynamic";

const D = domain("documents")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Documents & Templates"
        purpose="Document categories, default templates, required metadata and issuance behaviour — and the rule that an issued document is never rewritten by a later configuration change."
        spec="CPR-PD-011 §11"
      />

      <Warn title="An issued document is evidence, not a rendering">
        <p>
          §11: template content and versioning must preserve the integrity of already-issued documents. A
          document that was generated, signed and given to a patient is what the clinician issued — so a
          later template change must produce different FUTURE documents and must never alter that one.
          This is the identical rule the practitioner-number format already enforces in code, and it is
          the rule an editor is most likely to break, because re-rendering from a template is the
          obvious implementation and it is the wrong one.
        </p>
      </Warn>

      <Panel title="Where the product constraint ends and the Practice's choice begins (§11)"
        note="Letterhead is the worked example the specification gives.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">The Practice owns its letterhead</span> — its
            name, its logo, its address. That is the practice&apos;s identity and it would be wrong for a
            landlord to set it.
          </li>
          <li>
            <span className="font-semibold text-gray-900">The product owns the constraints around it</span>{" "}
            — what must appear, what may not be removed, what a generated document must always carry.
            That is this module&apos;s half, and it is the half with no store: no definition declares a
            document constraint, so &quot;within allowed product constraints&quot; currently means
            whatever the generator happens to do.
          </li>
          <li>
            <span className="font-semibold text-gray-900">The registry has the right vocabulary for the
            boundary and no rows in it</span> —{" "}
            <span className="font-mono text-[11px]">override_policy = &apos;narrow_only&apos;</span> and{" "}
            <span className="font-mono text-[11px]">&apos;local_display_only&apos;</span> are exactly
            &quot;a Practice may adjust the presentation but not the rule&quot;, and no document setting
            is registered to carry either.
          </li>
        </ul>
      </Panel>

      <Panel title="Why this page offers no template editor (§11, §31)"
        note="A non-goal that is genuinely load-bearing rather than a scoping note.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          §11 forbids storing executable or untrusted template logic without sandboxing and validation,
          and §31 states plainly that Product Configuration is not an unrestricted database or admin
          editor.{" "}
          <span className="font-semibold">
            A template body is the one configuration value that is also code
          </span>
          {" "}— placeholders, conditionals and loops are a small language, and a landlord-side editor
          writing that language into a store a document generator later executes is a remote-code path
          wearing a settings screen. Nothing here edits a template, and adding one is a security design
          question before it is a product one.
        </p>
        <Explain summary="What would have to exist first">
          A declared template schema with a validator that runs server-side (§19), a sandbox for
          evaluation, an approval class on the definition (§4), an immutable version per issued document
          so integrity survives the next edit (§11), and a rollback that revalidates against current
          dependencies (§21). None of the five exists. The frozen Documents architecture already handles
          shared, issued, review, task and library behaviour on the Practice plane; §11 requires this
          module to use it rather than grow a second one.
        </Explain>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23: whether document generation is deployed is Releases &amp; Capabilities&apos;. §24: document
        generation failures are Product Health&apos;s. The frozen Documents architecture itself belongs
        to the Practice product, not to this module.
      </NotThisModule>

      <NoReadNote why="Every document and template store is on the Practice plane and refused to it." />
    </div>
  );
}
