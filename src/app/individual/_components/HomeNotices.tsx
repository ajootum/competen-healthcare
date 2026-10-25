/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadNotices } from "@/lib/individual/notifications";
import { ApiButton } from "./professional/forms";
import { focusRing } from "./chrome";

// Notices in the person's own account (migration 437, owner: "Use notifications in the user account, not Email").
// Reusable by any Individual notice: rendered on the experience home for every experience, because a notice belongs
// to the person. Nothing renders when there is nothing to show, or while 437 is absent. Unread first, newest first.
// Text in words, the unread state in words too (never colour alone).

export default async function HomeNotices({ admin, userId, accent }: { admin: any; userId: string; accent: string }) {
  const n = await loadNotices(admin, userId, 20);
  if (n === null) return <p className="mb-5 text-[13px] text-gray-600">Your notices could not be read just now.</p>;
  if (!n.available) return null;
  const items = [...n.items.filter(i => !i.readAt), ...n.items.filter(i => i.readAt)].slice(0, 6);
  const unread = n.items.filter(i => !i.readAt).length;
  if (!unread) return null;
  return (
    <section aria-labelledby="notices-h" className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <h2 id="notices-h" className="text-[15px] font-bold text-gray-900">Notices <span className="font-semibold text-gray-600">· {unread} unread</span></h2>
      <ul className="mt-2 divide-y divide-slate-200">
        {items.map(i => (
          <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
            <div className="min-w-0 max-w-prose">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                {i.readAt ? "Read" : "Unread"} · {new Date(i.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
              </p>
              <p className={`text-[14px] ${i.readAt ? "text-gray-600" : "text-gray-900"}`}>{i.body}</p>
              {i.href && <a href={i.href} className={`text-[13px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>Open</a>}
            </div>
            {!i.readAt && <ApiButton action="/api/individual/notifications" method="PATCH" body={{ id: i.id }} label="Mark as read" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
