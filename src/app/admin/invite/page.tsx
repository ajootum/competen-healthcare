"use client";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function InvitePage() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [hospitalName, setHospitalName] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("hospital_id")
        .eq("id", user.id)
        .single();
      if (profile?.hospital_id) {
        setHospitalId(profile.hospital_id);
        const { data: hospital } = await supabase
          .from("hospitals")
          .select("name")
          .eq("id", profile.hospital_id)
          .single();
        setHospitalName(hospital?.name ?? "");
      }
    })();
  }, []);

  const signupUrl = typeof window !== "undefined"
    ? `${window.location.origin}/signup`
    : "https://competen.vercel.app/signup";

  const whatsappMessage = `Hi! You're invited to join Competen Healthcare — a professional nursing competency platform.\n\n📱 Sign up here: ${signupUrl}\n\n🏥 During sign up, enter this Hospital ID:\n${hospitalId ?? "Loading..."}\n\nCompeten helps you track your CPD hours, competencies, and clinical skills. See you there! 🩺`;

  const copyHospitalId = () => {
    if (hospitalId) { navigator.clipboard.writeText(hospitalId); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };
  const copyMessage = () => {
    navigator.clipboard.writeText(whatsappMessage);
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Invite Nurses</h1>
        <p className="text-gray-400 text-sm mt-0.5">Share your hospital code so nurses can link their accounts.</p>
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-blue-800 mb-3">How to invite a nurse</p>
        <ol className="flex flex-col gap-2 text-sm text-blue-700">
          <li className="flex items-start gap-2"><span className="font-bold shrink-0">1.</span> Copy your Hospital ID below</li>
          <li className="flex items-start gap-2"><span className="font-bold shrink-0">2.</span> Share it with the nurse via WhatsApp, SMS, or email</li>
          <li className="flex items-start gap-2"><span className="font-bold shrink-0">3.</span> The nurse signs up at <strong>{signupUrl}</strong></li>
          <li className="flex items-start gap-2"><span className="font-bold shrink-0">4.</span> They enter the Hospital ID in their profile — they appear on your roster automatically</li>
        </ol>
      </div>

      {/* Hospital ID */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-2">Your Hospital ID</p>
        {hospitalName && <p className="text-sm font-semibold text-gray-900 mb-3">{hospitalName}</p>}
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-mono text-gray-800 break-all">
            {hospitalId ?? "Loading..."}
          </code>
          <button
            onClick={copyHospitalId}
            disabled={!hospitalId}
            className="shrink-0 text-xs bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-lg transition-colors font-medium">
            {copied ? "Copied ✓" : "Copy ID"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">The nurse enters this ID in Dashboard → Profile → Hospital ID</p>
      </div>

      {/* Sign-up link */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-2">Sign-up Link</p>
        <div className="flex items-center gap-3">
          <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-mono text-gray-700 truncate">
            {signupUrl}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(signupUrl); }}
            className="shrink-0 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg transition-colors font-medium">
            Copy
          </button>
        </div>
      </div>

      {/* WhatsApp message */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Ready-to-send WhatsApp Message</p>
          <button
            onClick={copyMessage}
            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
            {msgCopied ? "Copied ✓" : "📋 Copy message"}
          </button>
        </div>
        <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
          {whatsappMessage}
        </pre>
      </div>

      {/* Note */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <strong>Note:</strong> Email invitations with direct links are coming soon. For now, WhatsApp or SMS with the Hospital ID is the fastest way to onboard nurses in East Africa.
      </div>
    </div>
  );
}
