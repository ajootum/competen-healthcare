"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Account Management (spec §2 Settings): profile editing, profile image and
// password change. Email change needs a confirmation-mail flow that isn't
// configured yet — shown read-only, not faked.

export type ProfileFields = {
  full_name: string; email: string; phone: string; country: string;
  specialization: string; avatar_url: string | null; role: string;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";
}

const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500";
const label = "block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1";

export default function AccountSettings({ profile }: { profile: ProfileFields }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    full_name: profile.full_name, phone: profile.phone,
    country: profile.country, specialization: profile.specialization,
  });
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true); setProfileMsg(null);
    const res = await fetch("/api/account/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    setProfileMsg(res.ok ? { ok: true, text: "Profile updated" } : { ok: false, text: body.error ?? "Update failed" });
    setSavingProfile(false);
    if (res.ok) router.refresh();
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true); setProfileMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/account/avatar", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { setAvatarUrl(body.avatar_url); router.refresh(); }
    else setProfileMsg({ ok: false, text: body.error ?? "Image upload failed" });
    setAvatarBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    const res = await fetch("/api/account/avatar", { method: "DELETE" });
    if (res.ok) { setAvatarUrl(null); router.refresh(); }
    setAvatarBusy(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: "New passwords don't match" }); return; }
    setSavingPw(true);
    const res = await fetch("/api/account/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: pw.current, new_password: pw.next }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) { setPw({ current: "", next: "", confirm: "" }); setPwMsg({ ok: true, text: "Password changed" }); }
    else setPwMsg({ ok: false, text: body.error ?? "Password change failed" });
    setSavingPw(false);
  }

  const pwType = showPw ? "text" : "password";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {/* Profile */}
      <form onSubmit={saveProfile} className="bg-white border border-gray-100 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-4">👤 Profile</h2>

        <div className="flex items-center gap-4 mb-5">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar from Supabase storage, not a static asset
            <img src={avatarUrl} alt="Profile photo" className="w-16 h-16 rounded-full object-cover border border-gray-100" />
          ) : (
            <span className="w-16 h-16 rounded-full bg-teal-600 text-white text-xl font-bold flex items-center justify-center">
              {initials(form.full_name)}
            </span>
          )}
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={avatarBusy}
              className="text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors text-left">
              {avatarBusy ? "Working…" : avatarUrl ? "Change photo" : "Upload photo"}
            </button>
            {avatarUrl && (
              <button type="button" onClick={removeAvatar} disabled={avatarBusy}
                className="text-[10px] text-gray-400 hover:text-red-500 text-left transition-colors">
                Remove photo
              </button>
            )}
            <p className="text-[9px] text-gray-300">PNG, JPEG or WebP · max 2 MB</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label}>Full Name</label>
            <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>Email</label>
            <input value={profile.email} disabled className={`${input} bg-gray-50 text-gray-400`} />
            <p className="text-[9px] text-gray-300 mt-1">Email change isn&apos;t available yet.</p>
          </div>
          <div>
            <label className={label}>Phone</label>
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+256 …" className={input} />
          </div>
          <div>
            <label className={label}>Country</label>
            <input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="e.g. Uganda" className={input} />
          </div>
          <div>
            <label className={label}>Specialisation</label>
            <input value={form.specialization} onChange={e => setForm({ ...form, specialization: e.target.value })} placeholder="e.g. Paediatric nursing" className={input} />
          </div>
        </div>

        {profileMsg && (
          <p className={`text-xs rounded-lg px-3 py-2 mt-3 ${profileMsg.ok ? "text-green-700 bg-green-50 border border-green-100" : "text-red-600 bg-red-50 border border-red-100"}`}>
            {profileMsg.text}
          </p>
        )}
        <button type="submit" disabled={savingProfile}
          className="mt-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {savingProfile ? "Saving…" : "Save profile"}
        </button>
      </form>

      {/* Security */}
      <form onSubmit={changePassword} className="bg-white border border-gray-100 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-1">🔒 Security</h2>
        <p className="text-[10px] text-gray-400 mb-4">Signed in as <span className="text-gray-600">{profile.email}</span> · {profile.role.replace(/_/g, " ")}</p>

        <div className="flex flex-col gap-3">
          <div>
            <label className={label}>Current Password</label>
            <input type={pwType} required value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })}
              autoComplete="current-password" className={input} />
          </div>
          <div>
            <label className={label}>New Password</label>
            <input type={pwType} required minLength={8} value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })}
              autoComplete="new-password" placeholder="At least 8 characters" className={input} />
          </div>
          <div>
            <label className={label}>Confirm New Password</label>
            <input type={pwType} required value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })}
              autoComplete="new-password" className={input} />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-500 select-none">
            <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} className="accent-teal-600" />
            Show passwords
          </label>
        </div>

        {pwMsg && (
          <p className={`text-xs rounded-lg px-3 py-2 mt-3 ${pwMsg.ok ? "text-green-700 bg-green-50 border border-green-100" : "text-red-600 bg-red-50 border border-red-100"}`}>
            {pwMsg.text}
          </p>
        )}
        <button type="submit" disabled={savingPw}
          className="mt-4 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
          {savingPw ? "Changing…" : "Change password"}
        </button>
        <p className="text-[9px] text-gray-300 mt-3">
          Your current password is verified before any change. Other sessions stay signed in until they expire.
        </p>
      </form>
    </div>
  );
}
