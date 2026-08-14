"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ATTACHMENT_KINDS } from "@/lib/practice/documentation-tools";
import { PANEL, SectionHeader, EmptyState, Tip } from "@/components/practice/EncounterKit";
import { ClinicalRecordTable, type RecordColumn } from "@/components/practice/ClinicalRecordTable";
import { BAND_RECORD, BAND_WORK } from "@/lib/practice/encounter-band-constants";
import { formatDayTime } from "@/lib/datetime";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-ATT-HFE-009 -- THE ENCOUNTER ATTACHMENTS WORKSPACE.
//
// ⚠ ATTACHMENTS WERE COLLAPSED INSIDE AN ACCORDION ON A TAB CALLED ATTACHMENTS. They were one of three
// chips in "Documentation tools", closed by default, beside clinical calculators and smart text. A
// practitioner who clicked Attachments saw a table of DOCUMENTS and a chip -- s4's first objective is
// "immediately answer: what files belong to this encounter?", and the answer was behind a click most
// people would never make. This file exists so the files are the first thing on the tab.
//
// ⚠ AND CHOOSING A FILE USED TO UPLOAD IT INSTANTLY, WITH THE METADATA SCRAPED OUT OF THE DOM.
//
//     onChange={e => { const f = e.target.files?.[0];
//       if (f) upload(f, (document.getElementById("att-kind") as HTMLSelectElement)?.value ?? "other",
//         (document.getElementById("att-caption") as HTMLInputElement)?.value ?? ""); }}
//
// Two faults in four lines. There was no review step at all, so s7's "select the file first, THEN show
// the metadata" ran backwards: the category and caption had to be typed BEFORE picking the file or they
// were silently lost -- and nothing on screen said so. And the values were read by getElementById from
// uncontrolled inputs, so React had no idea what was being sent. Picking a file is now a selection; the
// upload is a separate, explicit act.
//
// ⚠ WHAT IS DELIBERATELY NOT HERE, because it needs a migration and this half does not have one:
//   TITLE          s8 wants one, required, defaulting from the filename and editable. There is no
//                  `title` column; `file_name` is the storage-sanitised name and overloading it would
//                  make the record's copy of the filename editable, which it must not be.
//   TAGS           s8. No column, no join table.
//   VISIBILITY     s8/s10's "Show in patient's Documents". Visibility is STRUCTURAL today -- a row in
//                  practice_attachment appears in the Documents workspace because of the table it is
//                  in, and there is no way to keep one out. A checkbox with nothing behind it would be
//                  a control that silently does nothing, which is worse than its absence.
//   CATEGORIES     s9 wants procedure document, external clinical record and administrative. The `kind`
//                  CHECK in migration 207 is a closed allowlist of six and does not contain them.
//   REMOVAL KINDS  s15 wants remove-from-encounter, hide-from-patient-documents and delete-document
//                  told apart. There is one verb and one soft-delete, so the screen offers one and says
//                  plainly what it does rather than implying three.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

type Attachment = {
  id: string; file_name: string; kind: string; caption: string | null;
  byte_size: number; created_at: string;
};

const KIND_LABEL = Object.fromEntries(ATTACHMENT_KINDS as readonly (readonly [string, string])[]);

const input =
  "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-gray-600";

const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function EncounterAttachments(props: {
  encounterId: string;
  patientId: string;
  attachments: Attachment[];
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // s7: the file is CHOSEN into state and committed separately. `pending` being non-null is what makes
  // the metadata appear -- s7 forbids "a large empty metadata form before a file has been selected".
  const [pending, setPending] = useState<File | null>(null);
  const [meta, setMeta] = useState({ kind: "photograph", caption: "" });
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  /** s13's duplicate check, answered but not obeyed until the practitioner says so. */
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  // ⚠ s13: "PREVENT ACCIDENTAL DUPLICATE UPLOAD WHERE RELIABLE DETECTION IS AVAILABLE WHILE PERMITTING
  // LEGITIMATE DUPLICATES WHEN EXPLICITLY CONFIRMED." Name and size is the most this can honestly claim
  // -- there is no content hash on the row, so two different files with one name would not be caught
  // and two identical files under different names would not either. It therefore WARNS and lets the
  // practitioner proceed; a hard block on a guess this weak would refuse legitimate re-uploads.
  const duplicate = useMemo(() => {
    if (!pending) return null;
    return props.attachments.find(a =>
      a.file_name.toLowerCase() === pending.name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120).toLowerCase()
      && a.byte_size === pending.size) ?? null;
  }, [pending, props.attachments]);

  const choose = (f: File | undefined | null) => {
    if (!f) return;
    setPending(f);
    setConfirmDuplicate(false);
    setNotice(null);
  };

  async function commit() {
    if (!pending) return;
    setBusy(true); setNotice(null);
    try {
      const form = new FormData();
      form.set("file", pending); form.set("encounterId", props.encounterId);
      form.set("kind", meta.kind); form.set("caption", meta.caption);
      const res = await fetch("/api/v1/practice/attachments", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // ⚠ s13: "A FAILED UPLOAD MUST NEVER APPEAR SUCCESSFULLY ATTACHED." The selection is kept so the
        // practitioner can retry without finding the file again, and nothing is added to the list --
        // which is the server's list, re-read, not an optimistic row.
        setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not upload, and nothing was attached." });
        return;
      }
      setPending(null); setMeta({ kind: "photograph", caption: "" }); setConfirmDuplicate(false);
      setNotice({ kind: "ok", text: "Attached to this encounter." });
      // ⚠ router.refresh(), NOT window.location.reload(). A full reload of a live consultation threw
      // away every unsaved note segment on the screen -- on the tab whose whole job is adding a file.
      router.refresh();
    } catch {
      setNotice({ kind: "err", text: "That did not reach the server, so nothing was attached." });
    } finally { setBusy(false); }
  }

  async function open(id: string) {
    setNotice(null);
    const res = await fetch(`/api/v1/practice/attachments?id=${id}`);
    const data = await res.json().catch(() => ({}));
    // The URL is signed and expires in a minute; the storage path never reaches the browser.
    if (res.ok && data.url) window.open(data.url, "_blank", "noopener");
    else setNotice({ kind: "err", text: "That file could not be opened." });
  }

  async function remove(id: string) {
    if (!removeReason.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(
        `/api/v1/practice/attachments?id=${id}&reason=${encodeURIComponent(removeReason.trim())}`,
        { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: "err", text: data?.error?.message ?? "That was not removed." });
        return;
      }
      setRemoving(null); setRemoveReason("");
      setNotice({ kind: "ok", text: "Removed from this encounter. The record of it stays, with your reason." });
      router.refresh();
    } finally { setBusy(false); }
  }

  // s6's columns: File | Type | Added | Actions. Actions is added by ClinicalRecordTable itself.
  const COLUMNS: RecordColumn<Attachment>[] = [
    { key: "file", label: "File", priority: "primary",
      render: a => (
        <>
          <span className="font-semibold text-gray-800">{a.file_name}</span>
          <span className="ml-1.5 text-[11px] text-gray-500">{sizeOf(a.byte_size)}</span>
        </>
      ) },
    { key: "kind", label: "Type", priority: "secondary",
      render: a => <span className="text-[11.5px] text-gray-600">{KIND_LABEL[a.kind] ?? a.kind}</span> },
    // ⚠ s6's "Added" WAS NEVER DRAWN, and it was already on the row: created_at is selected by
    // listAttachments and published by the route, and no screen has ever shown it. A file with no date
    // in a clinical record is a file nobody can place in a sequence of events.
    { key: "added", label: "Added", priority: "status",
      render: a => (
        <span className="text-[11.5px] text-gray-600">
          {formatDayTime(a.created_at) ?? String(a.created_at).slice(0, 16).replace("T", " ")}
        </span>
      ) },
  ];

  return (
    <section className={PANEL}>
      <SectionHeader
        title="Attachments"
        subtitle={`Files belonging to this consultation. ${props.attachments.length} attached.`}
      />
      <div className="p-4">
        {notice && (
          <p role="status" className={`mb-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
            ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
            {notice.text}
          </p>
        )}

        {/* ══ BAND 1 (s5, s16): FILES IN THIS ENCOUNTER ══════════════════════════════════════════ */}
        <div className={`${BAND_RECORD} overflow-hidden p-3`}>
          <ClinicalRecordTable
            label="Files attached to this encounter"
            columns={COLUMNS}
            empty={
              // ⚠ s17 asks for "No files attached to this encounter." The old line was "Nothing
              // attached." in grey -- which reads equally as "the list could not be read". This one
              // says the read worked, the way every other empty state on this screen does.
              <EmptyState title="No files attached to this encounter"
                reason="This was read successfully -- attach one below if something belongs with this consultation." />
            }
            records={props.attachments.map(a => ({
              id: a.id,
              data: a,
              secondaryText: a.caption ? a.caption : undefined,
              actions: (
                <span className="inline-flex items-center gap-1.5">
                  {/* ⚠ A LABELLED ACTION, NOT THE FILENAME. Opening used to be done by clicking the
                      name, which is not an affordance anybody can see -- s14 asks for a View/Open. */}
                  <button type="button" onClick={() => open(a.id)}
                    aria-label={`Open ${a.file_name}`}
                    className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                    Open
                  </button>
                  {props.editable && (
                    // ⚠ s15: NOT LABELLED "DELETE", because it is not one. It detaches the file from
                    // this encounter and keeps the row, the reason and who did it. The other two verbs
                    // s15 names -- hide from patient documents, delete the document -- do not exist in
                    // this schema, so they are not offered as if they did.
                    <button type="button" disabled={busy}
                      onClick={() => { setRemoveReason(""); setRemoving(removing === a.id ? null : a.id); }}
                      aria-label={`Remove ${a.file_name} from this encounter`}
                      className="rounded-lg px-2 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
                      {removing === a.id ? "Cancel" : "Remove"}
                    </button>
                  )}
                </span>
              ),
              expandedContent: removing === a.id ? (
                // ⚠ AN INLINE FORM, NOT window.prompt(). The reason is part of the clinical record --
                // it is stored on the row and cannot be edited afterwards -- and a browser prompt gives
                // it no label, no validation, no way back, and renders differently in every browser.
                <form className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2"
                  onSubmit={e => { e.preventDefault(); remove(a.id); }}>
                  <label className="flex-1 min-w-[240px]">
                    <span className="sr-only">Why {a.file_name} is being removed</span>
                    <input autoFocus value={removeReason} disabled={busy}
                      onChange={e => setRemoveReason(e.target.value)}
                      placeholder="Why is this being removed?"
                      className={input} />
                  </label>
                  <button type="submit" disabled={busy || !removeReason.trim()}
                    className="rounded-lg border border-rose-300 px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                    Remove from this encounter
                  </button>
                  <p className="w-full text-[11px] text-gray-600">
                    The file itself is deleted and cannot be recovered. The record that it existed, who
                    removed it and why, stays on this encounter.
                  </p>
                </form>
              ) : undefined,
            }))}
          />
        </div>

        {/* ══ BAND 2 (s5, s16): ADD ATTACHMENT -- THE ACTIVE WORK ════════════════════════════════ */}
        {props.editable && (
          <div className={`${BAND_WORK} mt-3 p-4`}>
            <h3 className="text-[13px] font-bold text-gray-900">Add an attachment</h3>

            {!pending ? (
              // s7 step 1. ⚠ AND NOTHING ELSE IS DRAWN YET: no category, no caption, no commit button.
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0]); }}
                className={`mt-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging
                  ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/[0.07]"
                  : "border-[var(--cp-primary)]/30 bg-white/60"}`}>
                <p className="text-[12.5px] font-semibold text-gray-800">Drop a file here</p>
                <p className="mt-0.5 text-[11.5px] text-gray-600">or</p>
                <label className="mt-1.5 inline-block cursor-pointer rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                  Browse files
                  <input type="file" className="sr-only"
                    accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                    onChange={e => choose(e.target.files?.[0])} />
                </label>
                <p className="mt-2 text-[11px] text-gray-600">
                  Images and PDFs, up to 25 MB.
                </p>
              </div>
            ) : (
              // s7 steps 3-6. The metadata appears only now, and the commit is explicit.
              <div className="mt-2">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-[12.5px] font-semibold text-gray-800">{pending.name}</span>
                  <span className="text-[11.5px] text-gray-500">{sizeOf(pending.size)}</span>
                  <button type="button" disabled={busy}
                    onClick={() => { setPending(null); setConfirmDuplicate(false); }}
                    className="ml-auto rounded-lg px-2 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                    Choose a different file
                  </button>
                </div>

                {duplicate && (
                  // s13's duplicate handling: warned, and permitted once confirmed.
                  <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-[var(--cmp-surface-warning)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-warning)]">
                    <input type="checkbox" checked={confirmDuplicate} className="mt-0.5"
                      onChange={e => setConfirmDuplicate(e.target.checked)} />
                    <span>
                      A file with this name and size is already attached to this encounter. Attach it
                      again anyway &mdash; this makes a second file, it does not replace the first.
                    </span>
                  </label>
                )}

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={LABEL} htmlFor="att-kind">Category *</label>
                    {/* ⚠ CONTROLLED, unlike the getElementById pair this replaces. */}
                    <select id="att-kind" value={meta.kind} disabled={busy}
                      onChange={e => setMeta(m => ({ ...m, kind: e.target.value }))}
                      className={`${input} mt-1`}>
                      {ATTACHMENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="att-caption">Note</label>
                    <input id="att-caption" value={meta.caption} disabled={busy}
                      onChange={e => setMeta(m => ({ ...m, caption: e.target.value }))}
                      placeholder="Optional. What this file is."
                      className={`${input} mt-1`} />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={commit}
                    disabled={busy || (!!duplicate && !confirmDuplicate)}
                    className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] focus-visible:ring-offset-2 disabled:opacity-50">
                    {/* s13: progress, in words, naming the file so a slow upload is legible. */}
                    {busy ? `Uploading ${pending.name}...` : "Add attachment"}
                  </button>
                  {!!duplicate && !confirmDuplicate && (
                    <span className="text-[11.5px] text-[var(--cmp-text-warning)]">
                      Confirm the duplicate above to continue.
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-3">
              <Tip>
                Files are private. Opening one uses a link that expires after a minute, and every open is
                recorded as a read of this patient&apos;s record.
              </Tip>
            </div>
          </div>
        )}

        {/* ══ BAND 3 (s5, s17): BROADER DOCUMENT ACCESS, AS QUIET LINKS ══════════════════════════ */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={`/practice/documents/patient?patientId=${props.patientId}`}
            className="text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            All documents for this patient &rarr;
          </Link>
          <Link href="/practice/inbox"
            className="text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Record a document that arrived &rarr;
          </Link>
          {/* ⚠ NO "CAPTURE FROM DEVICE" LINK. s19 lists one and there is no capture route in this
              product -- the assessor workspace has a camera, the practice encounter does not. A third
              tile going nowhere is the affordance-for-nothing this session has already refused twice. */}
        </div>
      </div>
    </section>
  );
}
