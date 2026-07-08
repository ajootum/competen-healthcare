"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES } from "@/lib/countries";

const ORG_TYPES = ["government","private","ngo","faith_based","academic"] as const;

type Org = { id: string; name: string; group_name: string | null; type: string; hq_country: string; region: string | null; description: string | null; website: string | null; email: string | null; phone: string | null; is_active: boolean };
type Facility = { id: string; name: string; type: string; country: string; city: string | null; tier: string; organisation_id: string | null };

type Mode =
  | { kind: "add-org" }
  | { kind: "add-facility"; orgs: Org[] }
  | { kind: "edit-org"; org: Org }
  | { kind: "edit-facility"; facility: Facility; orgs: Org[] };

export default function OrgManager({ orgs, mode: externalMode }: { orgs?: Org[]; mode?: Mode }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!externalMode);
  const [tab, setTab] = useState<"org" | "facility">("org");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const editOrg = externalMode?.kind === "edit-org" ? externalMode.org : null;
  const editFac = externalMode?.kind === "edit-facility" ? externalMode.facility : null;
  const isEdit = !!editOrg || !!editFac;

  const [orgForm, setOrgForm] = useState({
    name: editOrg?.name ?? "",
    group_name: editOrg?.group_name ?? "",
    type: editOrg?.type ?? "private",
    hq_country: editOrg?.hq_country ?? "Kenya",
    region: editOrg?.region ?? "",
    description: editOrg?.description ?? "",
    website: editOrg?.website ?? "",
    email: editOrg?.email ?? "",
    phone: editOrg?.phone ?? "",
  });

  const [facForm, setFacForm] = useState({
    name: editFac?.name ?? "",
    type: editFac?.type ?? "hospital",
    country: editFac?.country ?? "Kenya",
    city: editFac?.city ?? "",
    tier: editFac?.tier ?? "free",
    organisation_id: editFac?.organisation_id ?? "",
  });

  async function saveOrg() {
    if (!orgForm.name) { setError("Organisation name is required"); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/organisations", {
      method: editOrg ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editOrg ? { id: editOrg.id, ...orgForm } : orgForm),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setOpen(false);
    router.refresh();
  }

  async function saveFacility() {
    if (!facForm.name) { setError("Facility name is required"); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/super-admin/facilities", {
      method: editFac ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editFac ? { id: editFac.id, ...facForm } : facForm),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setOpen(false);
    router.refresh();
  }

  async function deleteOrg() {
    if (!editOrg || !confirm(`Delete "${editOrg.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/super-admin/organisations?id=${editOrg.id}`, { method: "DELETE" });
    setDeleting(false);
    setOpen(false);
    router.refresh();
  }

  async function deleteFacility() {
    if (!editFac || !confirm(`Delete "${editFac.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/super-admin/facilities?id=${editFac.id}`, { method: "DELETE" });
    setDeleting(false);
    setOpen(false);
    router.refresh();
  }

  const availableOrgs = orgs ?? (externalMode?.kind === "add-facility" ? externalMode.orgs : externalMode?.kind === "edit-facility" ? externalMode.orgs : []);
  const activeTab = editFac ? "facility" : editOrg ? "org" : tab;

  if (isEdit) {
    return (
      <Modal
        open={open} onClose={() => setOpen(false)}
        title={editOrg ? "Edit Organisation" : "Edit Facility"}
        onSave={editOrg ? saveOrg : saveFacility}
        onDelete={editOrg ? deleteOrg : deleteFacility}
        saving={saving} deleting={deleting} error={error}
        isEdit
      >
        {editOrg ? (
          <OrgFields form={orgForm} onChange={setOrgForm} />
        ) : (
          <FacilityFields form={facForm} onChange={setFacForm} orgs={availableOrgs} />
        )}
      </Modal>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700">
        + Add
      </button>

      {open && (
        <Modal
          open={open} onClose={() => { setOpen(false); setError(""); }}
          title="Add New"
          onSave={activeTab === "org" ? saveOrg : saveFacility}
          saving={saving} error={error}
        >
          <div className="flex gap-1 mb-4">
            {(["org","facility"] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setError(""); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t ? "bg-rose-100 text-rose-700" : "text-gray-500 hover:bg-gray-100"
                }`}>
                {t === "org" ? "🏛️ Organisation Group" : "🏥 Facility"}
              </button>
            ))}
          </div>
          {activeTab === "org"
            ? <OrgFields form={orgForm} onChange={setOrgForm} />
            : <FacilityFields form={facForm} onChange={setFacForm} orgs={availableOrgs} />
          }
        </Modal>
      )}
    </>
  );
}

function Modal({ open, onClose, title, onSave, onDelete, saving, deleting, error, isEdit, children }: {
  open: boolean; onClose: () => void; title: string;
  onSave: () => void; onDelete?: () => void;
  saving: boolean; deleting?: boolean; error: string; isEdit?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6 flex flex-col gap-3">
          {children}
          {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            {isEdit && onDelete && (
              <button onClick={onDelete} disabled={deleting}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 font-medium">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
            <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={onSave} disabled={saving}
              className="flex-1 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-60">
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrgFields({ form, onChange }: {
  form: { name: string; group_name: string; type: string; hq_country: string; region: string; description: string; website: string; email: string; phone: string };
  onChange: (f: typeof form) => void;
}) {
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...form, [k]: e.target.value });
  return (
    <>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">Organisation / Group Name *</label>
        <input value={form.name} onChange={set("name")} placeholder="e.g. Aga Khan Health Services"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">Abbreviation / Short Name</label>
        <input value={form.group_name} onChange={set("group_name")} placeholder="e.g. AKHS"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">Description</label>
        <textarea value={form.description} onChange={set("description")} rows={2}
          placeholder="Brief description…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Type *</label>
          <select value={form.type} onChange={set("type")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            {ORG_TYPES.map(t => <option key={t} value={t}>{t.replace("_"," ")}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">HQ Country *</label>
          <select value={form.hq_country} onChange={set("hq_country")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            {COUNTRIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Email</label>
          <input type="email" value={form.email} onChange={set("email")} placeholder="admin@org.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Phone</label>
          <input value={form.phone} onChange={set("phone")} placeholder="+254…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">Website</label>
        <input value={form.website} onChange={set("website")} placeholder="https://…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
      </div>
    </>
  );
}

function FacilityFields({ form, onChange, orgs }: {
  form: { name: string; type: string; country: string; city: string; tier: string; organisation_id: string };
  onChange: (f: typeof form) => void;
  orgs: { id: string; name: string }[];
}) {
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...form, [k]: e.target.value });
  return (
    <>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">Facility Name *</label>
        <input value={form.name} onChange={set("name")} placeholder="e.g. Aga Khan Hospital Nairobi"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Country *</label>
          <select value={form.country} onChange={set("country")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            {COUNTRIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">City</label>
          <input value={form.city} onChange={set("city")} placeholder="e.g. Nairobi"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Facility Type *</label>
          <select value={form.type} onChange={set("type")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="hospital">Hospital</option>
            <option value="clinic">Clinic</option>
            <option value="health_center">Health Center</option>
            <option value="nursing_home">Nursing Home</option>
            <option value="diagnostic_center">Diagnostic Center</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Plan Tier</label>
          <select value={form.tier} onChange={set("tier")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="free">Free</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>
      {orgs.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Organisation Group</label>
          <select value={form.organisation_id} onChange={set("organisation_id")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">— None (unlinked) —</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
    </>
  );
}
