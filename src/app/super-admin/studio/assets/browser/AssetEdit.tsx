"use client";

import { useState } from "react";
import Link from "next/link";
import { ASSET_STATUS_SUPPORT, ASSET_VERSION_EDITABLE, ASSET_GOVERNED_ELSEWHERE, assetHref } from "@/lib/assets/service";

// CAP-001 Phase 4 (W2) — inline status/version editor for one asset row. Offers only the statuses that
// persist and round-trip for this type; types governed elsewhere (framework/publication) or with no source
// status (competency/blueprint/osce_station) get a pointer to the right surface instead of a fake control.

export default function AssetEdit({ objectType, objectId, currentStatus, currentVersion, onSaved }: {
  objectType: string; objectId: string; currentStatus: string | null; currentVersion: string | null;
  onSaved: (status?: string, version?: string) => void;
}) {
  const supported = ASSET_STATUS_SUPPORT[objectType] ?? [];
  const versionEditable = !!ASSET_VERSION_EDITABLE[objectType];
  const editable = supported.length > 0;

  const [status, setStatus] = useState(currentStatus && supported.includes(currentStatus) ? currentStatus : supported[0] ?? "");
  const [version, setVersion] = useState(currentVersion ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!editable) {
    return (
      <div className="border border-gray-100 rounded-lg bg-white p-3">
        <p className="text-[11px] text-gray-500">
          {ASSET_GOVERNED_ELSEWHERE[objectType] ?? "This asset type has no editable status here."}{" "}
          <Link href={assetHref(objectType, objectId)} className="font-semibold text-teal-700 hover:underline">Open source surface →</Link>
        </p>
      </div>
    );
  }

  async function save() {
    setBusy(true); setMsg(null);
    const body: Record<string, string> = { object_type: objectType, object_id: objectId };
    if (status && status !== currentStatus) body.status = status;
    if (versionEditable && version && version !== currentVersion) body.version = version;
    if (!body.status && !body.version) { setBusy(false); setMsg("No changes to save."); return; }
    const r = await fetch("/api/admin/assets/writeback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error ?? "Save failed"); return; }
    setMsg(j.warning ? `Saved — ${j.warning}` : "Saved.");
    onSaved(j.status, j.version);
  }

  return (
    <div className="border border-gray-100 rounded-lg bg-white p-3">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Govern status &amp; version</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-400 font-medium">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400">
            {supported.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
        {versionEditable && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 font-medium">Version</span>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. 2.1" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-24 focus:outline-none focus:ring-1 focus:ring-teal-400" />
          </label>
        )}
        <button onClick={save} disabled={busy} className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-4 py-1.5">{busy ? "Saving…" : "Save"}</button>
        {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">Writes to the source in its native convention, then updates the index.{supported.length <= 2 ? " This type only tracks active / archived." : ""}</p>
    </div>
  );
}
