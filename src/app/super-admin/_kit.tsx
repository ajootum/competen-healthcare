// Shared presentation kit — extracted, not redesigned.
 

// Lifted verbatim from src/app/super-admin/enterprise/facilities/[id]/FacilityProfileClient.tsx — written out identically in several
// pages, so this is one implementation replacing N copies, not a redesign.
export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0"><span className="text-gray-500">{label}</span><span className="text-gray-800 text-right">{value ?? <span className="text-gray-500">—</span>}</span></div>;
}
