"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type Hospital = { id: string; name: string; city: string | null; country: string; tier: string };
type Profile  = { full_name: string; email: string | null; phone: string | null; specialization: string | null };

export default function SettingsPage() {
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [profile,  setProfile]  = useState<Profile | null>(null);
  const [hospitalForm, setHF]   = useState({ name: "", city: "", country: "" });
  const [profileForm,  setPF]   = useState({ full_name: "", phone: "" });
  const [saving,    setSaving]  = useState<"hospital" | "profile" | null>(null);
  const [saved,     setSaved]   = useState<"hospital" | "profile" | null>(null);
  const [error,     setError]   = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, email, phone, specialization, hospital_id")
        .eq("id", user.id)
        .single();

      if (p) {
        setProfile(p);
        setPF({ full_name: p.full_name ?? "", phone: p.phone ?? "" });

        if (p.hospital_id) {
          const { data: h } = await supabase
            .from("hospitals")
            .select("id, name, city, country, tier")
            .eq("id", p.hospital_id)
            .single();
          if (h) {
            setHospital(h);
            setHF({ name: h.name, city: h.city ?? "", country: h.country });
          }
        }
      }
    })();
  }, []);

  const saveHospital = async () => {
    if (!hospital) return;
    setSaving("hospital"); setError("");
    const supabase = createClient();
    const { error: err } = await supabase
      .from("hospitals")
      .update({ name: hospitalForm.name, city: hospitalForm.city || null, country: hospitalForm.country })
      .eq("id", hospital.id);
    setSaving(null);
    if (err) { setError(err.message); return; }
    setHospital(prev => prev ? { ...prev, ...hospitalForm } : prev);
    setSaved("hospital");
    setTimeout(() => setSaved(null), 2500);
  };

  const saveProfile = async () => {
    setSaving("profile"); setError("");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error: err } = await supabase
      .from("profiles")
      .update({ full_name: profileForm.full_name, phone: profileForm.phone || null })
      .eq("id", user.id);
    setSaving(null);
    if (err) { setError(err.message); return; }
    setProfile(prev => prev ? { ...prev, ...profileForm } : prev);
    setSaved("profile");
    setTimeout(() => setSaved(null), 2500);
  };

  const tierBadge: Record<string, string> = {
    free:         "bg-gray-100 text-gray-600",
    professional: "bg-blue-100 text-blue-700",
    enterprise:   "bg-purple-100 text-purple-700",
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage your hospital and admin profile.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>
      )}

      {/* Hospital settings */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Hospital Details</h2>
          {hospital && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${tierBadge[hospital.tier] ?? "bg-gray-100 text-gray-600"}`}>
              {hospital.tier} plan
            </span>
          )}
        </div>

        {!hospital ? (
          <p className="text-sm text-gray-400">No hospital linked to your account.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">Hospital Name</label>
              <input
                value={hospitalForm.name}
                onChange={e => setHF(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">City</label>
                <input
                  value={hospitalForm.city}
                  onChange={e => setHF(p => ({ ...p, city: e.target.value }))}
                  placeholder="e.g. Nairobi"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">Country</label>
                <input
                  value={hospitalForm.country}
                  onChange={e => setHF(p => ({ ...p, country: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">Hospital ID (read-only)</label>
              <code className="block bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs text-gray-500 font-mono break-all">{hospital.id}</code>
            </div>
            <button
              onClick={saveHospital}
              disabled={saving === "hospital"}
              className="self-end text-sm bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg transition-colors font-medium">
              {saving === "hospital" ? "Saving…" : saved === "hospital" ? "Saved ✓" : "Save Hospital"}
            </button>
          </div>
        )}
      </div>

      {/* Admin profile */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-5">Admin Profile</h2>
        {!profile ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">Full Name</label>
              <input
                value={profileForm.full_name}
                onChange={e => setPF(p => ({ ...p, full_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">Email (read-only)</label>
              <input
                value={profile.email ?? ""}
                disabled
                className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-400 bg-gray-50 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 tracking-widest uppercase block mb-1">Phone / WhatsApp</label>
              <input
                value={profileForm.phone}
                onChange={e => setPF(p => ({ ...p, phone: e.target.value }))}
                placeholder="+254 700 000 000"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              />
            </div>
            <button
              onClick={saveProfile}
              disabled={saving === "profile"}
              className="self-end text-sm bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg transition-colors font-medium">
              {saving === "profile" ? "Saving…" : saved === "profile" ? "Saved ✓" : "Save Profile"}
            </button>
          </div>
        )}
      </div>

      {/* Subscription */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Subscription & Billing</h2>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-800 capitalize">{hospital?.tier ?? "Free"} Plan</p>
            <p className="text-xs text-gray-400 mt-0.5">Hospital-wide access</p>
          </div>
          <a href="/dashboard/billing"
            className="text-xs text-teal-600 hover:text-teal-700 font-medium border border-teal-200 px-3 py-1.5 rounded-lg transition-colors">
            Manage Plan →
          </a>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          To upgrade your hospital plan or discuss enterprise pricing, contact us at{" "}
          <a href="mailto:gabriel@semacast.com" className="text-teal-600 hover:underline">gabriel@semacast.com</a>
        </p>
      </div>
    </div>
  );
}
