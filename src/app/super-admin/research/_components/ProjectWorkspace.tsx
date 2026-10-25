import { ActionButton, FieldsForm } from "./ResearchControls";
import { INTEGRITY_ATTESTATION, INTEGRITY_FIELDS, PROTOCOL_FIELDS, type ProjectView } from "@/lib/knowledge/workspace";

// One research project's workspace (COMPETEN-KNOWLEDGE-RESEARCH-01 K4, migration 443), drawn for the team, a governor
// or an independent scientific reviewer. Each control posts to /api/hq/knowledge/research, which fixes its
// capability server-side, and 443 decides every write again.

type P = ProjectView;
const EP = "/api/hq/knowledge/research";
const label = (s: string) => s.replace(/_/g, " ");

export function ProjectWorkspace({ p, as }: { p: P; as: "team" | "governor" | "reviewer" }) {
  const frozenManuscripts = p.documents.filter((d) => d.kind === "manuscript" && d.state === "frozen");
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-[13px]" aria-labelledby={`p-${p.id}`}>
      <h2 id={`p-${p.id}`} className="text-[15px] font-bold text-gray-900">{p.title} <code className="text-[12px] font-normal text-gray-600">{p.code}</code></h2>
      <p className="text-gray-600">{p.purpose_code} · {p.sponsor} · <span className="font-medium">{p.status}</span> · cohort ≥ {p.min_cohort} · access: aggregate only{p.retain_until ? ` · outputs kept until ${p.retain_until}` : ""}</p>

      <div><h3 className="font-semibold text-gray-900">Documents</h3>
        <ul className="mt-1 space-y-1">{p.documents.map((d) => <li key={d.id} className="flex flex-wrap items-center gap-2">{label(d.kind)} v{d.version_no} · {d.state}
          {as === "team" && d.state === "draft" && <ActionButton endpoint={EP} body={{ action: "doc_freeze", documentId: d.id, projectId: p.id }} label="Freeze" done="Frozen." />}
          {as === "reviewer" && d.state === "frozen" && d.kind === "manuscript" && <details><summary className="cursor-pointer font-semibold text-teal-800">Review</summary><FieldsForm action="review" endpoint={EP} extra={{ projectId: p.id, documentId: d.id }} submit="Record review" done="Recorded."
            fields={[{ name: "decision", label: "Decision", kind: "select", options: ["endorse", "revise", "reject"], required: true }, { name: "comments", label: "Comments", kind: "textarea", required: true }]} /></details>}
        </li>)}</ul>
        {as === "team" && <div className="mt-2 flex flex-wrap gap-3">
          <details><summary className="cursor-pointer font-semibold text-teal-800">Write the protocol</summary><FieldsForm action="doc_write" endpoint={EP} extra={{ projectId: p.id, kind: "protocol" }} submit="Save" done="Saved as a new version."
            fields={PROTOCOL_FIELDS.map(f => ({ name: f, label: label(f), kind: "textarea" as const, required: true }))} /></details>
          {(["proposal", "analysis_plan", "manuscript"] as const).map(k => <details key={k}><summary className="cursor-pointer font-semibold text-teal-800">Write the {label(k)}</summary>
            <FieldsForm action="doc_write" endpoint={EP} extra={{ projectId: p.id, kind: k }} submit="Save" done="Saved as a new version." fields={[{ name: "text", label: label(k), kind: "textarea", required: true }]} /></details>)}
        </div>}
      </div>

      <div><h3 className="font-semibold text-gray-900">Team</h3>
        <ul className="mt-1 space-y-1">{p.members.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2">{label(m.role)}{m.external ? ` (external, agreement ${m.agreement_ref})` : ""} · {m.status} · aggregate only
          {as === "governor" && m.status === "proposed" && <ActionButton endpoint={EP} body={{ action: "member_appoint", memberId: m.id }} label="Appoint" done="Appointed." tone="primary" />}
          {as === "governor" && m.status === "active" && <ActionButton endpoint={EP} body={{ action: "member_end", memberId: m.id }} label="End" done="Ended." />}
        </li>)}</ul>
        {as === "team" && <details className="mt-1"><summary className="cursor-pointer font-semibold text-teal-800">Propose a member</summary><FieldsForm action="member_propose" endpoint={EP} extra={{ projectId: p.id }} submit="Propose" done="Proposed. A governor appoints."
          fields={[{ name: "personId", label: "Existing Competen profile id", required: true }, { name: "role", label: "Role", kind: "select", options: ["lead", "analyst", "reviewer", "external_collaborator"], required: true },
            { name: "external", label: "External to Competen", kind: "select", options: ["false", "true"] }, { name: "agreementRef", label: "Agreement reference (external members)" }]} /></details>}
      </div>

      <div><h3 className="font-semibold text-gray-900">Approved datasets (aggregate snapshots)</h3>
        <ul className="mt-1 space-y-1">{p.datasets.map((d) => <li key={d.id}>{d.label} · snapshot <code>{d.snapshot_id.slice(0, 8)}</code> · approved {String(d.approved_at).slice(0, 10)}</li>)}</ul>
        {as === "governor" && (p.status === "approved" || p.status === "recruiting") && <details className="mt-1"><summary className="cursor-pointer font-semibold text-teal-800">Approve a snapshot as a dataset</summary><FieldsForm action="dataset_approve" endpoint={EP} extra={{ projectId: p.id }} submit="Approve" done="Approved."
          fields={[{ name: "snapshotId", label: "Snapshot", kind: "select", options: p.snapshots.map((s) => s.id), required: true }, { name: "label", label: "Label", required: true }]} /></details>}
      </div>

      <div><h3 className="font-semibold text-gray-900">Statistical outputs</h3>
        <ul className="mt-1 space-y-1">{p.outputs.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2">{o.title} · {o.state}{o.uses_ai_marked ? " · includes AI-marked figures (not validated)" : ""}
          {as === "reviewer" && o.state === "frozen" && <details><summary className="cursor-pointer font-semibold text-teal-800">Review</summary><FieldsForm action="review" endpoint={EP} extra={{ projectId: p.id, outputId: o.id }} submit="Record review" done="Recorded."
            fields={[{ name: "decision", label: "Decision", kind: "select", options: ["endorse", "revise", "reject"], required: true }, { name: "comments", label: "Comments", kind: "textarea", required: true }]} /></details>}
        </li>)}</ul>
        {as === "team" && p.datasets.length > 0 && <details className="mt-1"><summary className="cursor-pointer font-semibold text-teal-800">Record an output</summary><FieldsForm action="output_write" endpoint={EP} extra={{ projectId: p.id, datasetIds: p.datasets.map((d) => d.id).join(",") }} submit="Save" done="Saved."
          fields={[{ name: "title", label: "Title", required: true }, { name: "results", label: "Results (JSON object of aggregate figures)", kind: "textarea", required: true },
            ...INTEGRITY_FIELDS.map(f => ({ name: f, label: label(f), kind: "textarea" as const, required: true })),
            { name: "usesAiMarked", label: "Uses AI-marked figures", kind: "select", options: ["false", "true"] }, { name: "ai_marked_statement", label: "If so: state they are not validated measurements", kind: "textarea" },
            { name: "freeze", label: "Freeze now", kind: "select", options: ["false", "true"] }]} /></details>}
      </div>

      <div><h3 className="font-semibold text-gray-900">Publication</h3>
        <ul className="mt-1 space-y-1">{p.publications.map((x) => <li key={x.id} className="space-y-1"><div>{x.venue} · {x.status}{x.integrity_attested ? " · integrity attested" : ""} · {p.reviews.filter((r) => r.document_id === x.manuscript_id && r.decision === "endorse").length} independent endorsements</div>
          <div className="flex flex-wrap gap-2">
            {as === "governor" && x.status === "requested" && <>
              <ActionButton endpoint={EP} body={{ action: "publication_approve", publicationId: x.id, attest: true }} label="Approve, attesting integrity" done="Approved." tone="primary" />
              <ActionButton endpoint={EP} body={{ action: "publication_reject", publicationId: x.id }} label="Reject" done="Rejected." note="Reason (required)" />
            </>}
            {as === "team" && x.status === "approved" && <ActionButton endpoint={EP} body={{ action: "publication_publish", publicationId: x.id }} label="Record as published" done="Recorded." />}
            {x.status === "published" && as !== "reviewer" && <ActionButton endpoint={EP} body={{ action: as === "team" ? "publication_correct" : "governor_correct", publicationId: x.id }} label="Record a correction" done="Recorded." note="What was corrected and why" />}
            {(x.status === "approved" || x.status === "published" || x.status === "requested") && as !== "reviewer" && <ActionButton endpoint={EP} body={{ action: as === "team" ? "publication_withdraw" : "governor_withdraw", publicationId: x.id }} label="Withdraw" done="Withdrawn." note="Why (required)" />}
          </div></li>)}</ul>
        {as === "governor" && <p className="mt-1 text-[12px] text-gray-600">Approving attests: {INTEGRITY_ATTESTATION}</p>}
        {as === "team" && frozenManuscripts.length > 0 && <details className="mt-1"><summary className="cursor-pointer font-semibold text-teal-800">Request publication</summary><FieldsForm action="publication_request" endpoint={EP} extra={{ projectId: p.id }} submit="Request" done="Requested."
          fields={[{ name: "manuscriptId", label: "Frozen manuscript", kind: "select", options: frozenManuscripts.map((d) => d.id), required: true }, { name: "venue", label: "Venue", required: true }]} /></details>}
      </div>
    </section>
  );
}
