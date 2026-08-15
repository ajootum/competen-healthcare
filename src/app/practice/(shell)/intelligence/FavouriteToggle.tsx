"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The star on a report template row -- CPR-PI-001 v2 s12's Favourites. State lives on the caller's
// preference row; this button only asks the API and refreshes, so the server list stays the truth.

export default function FavouriteToggle({ templateId, isFavourite }: {
  templateId: string; isFavourite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    await fetch("/api/v1/practice/reports/favourites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, favourite: !isFavourite }),
    });
    setBusy(false);
    router.refresh();
  };

  return (
    <button type="button" onClick={toggle} disabled={busy}
      title={isFavourite ? "Remove from favourites" : "Add to favourites"}
      aria-label={isFavourite ? `Remove ${templateId} from favourites` : `Add ${templateId} to favourites`}
      className={`rounded px-1 text-[13px] leading-none ${isFavourite ? "text-amber-500 hover:text-amber-600" : "text-gray-300 hover:text-amber-400"} disabled:opacity-40`}>
      {isFavourite ? "★" : "☆"}
    </button>
  );
}
