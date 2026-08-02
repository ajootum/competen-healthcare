import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { loadDay } from "@/lib/practice/scheduling";
import CalendarConsole from "./CalendarConsole";

// /practice/calendar (CPR-003 V3, PEN-001) -- the diary. Day view first: it is the view a practitioner
// operates from (Today's Schedule, the queue, quick actions are all day-scoped in CPR-003's own layout
// table). Week and month views arrive as the calendar matures; shipping them as empty grids today would
// be furniture, not function.
//
// Guard: the (shell) layout has already established READY; this page additionally requires
// practice.calendar.view (SHELL-001 s4 guard class CAPABILITY) -- server-side, not sidebar-side.

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.calendar.view")) redirect("/practice/home");

  const { date } = await searchParams;
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);

  const admin = createAdminClient();
  const initial = await loadDay(admin, shell.ctx.workspaceId, day);

  return (
    <CalendarConsole
      date={day}
      canManage={hasCapability(shell.ctx, "appointment.manage")}
      canQueue={hasCapability(shell.ctx, "queue.manage")}
      initial={JSON.parse(JSON.stringify(initial))}
    />
  );
}
