import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Legacy-path resolver for the Shift Supervisor Workspace.
//
// This route used to render a "next phase" placeholder for handover,
// communication, ai, analytics and settings. Four of those five were already
// DEAD CODE — /supervisor/handover, /supervisor/communication, /supervisor/ai
// and /supervisor/settings are real static routes, and a static route always
// wins over a dynamic segment in Next.js, so the placeholder never rendered.
// The fifth, /supervisor/analytics, was the only reachable one: the old sidebar
// linked to it, and it told supervisors the analytics they were already using
// every day was "a later phase".
//
// So there is nothing left to place-hold. Known legacy paths now redirect to
// the surface that actually owns the workflow; anything else falls back to the
// Shift Dashboard rather than showing a fabricated roadmap. Access control is
// enforced by the supervisor layout, which wraps this route.
const LEGACY: Record<string, string> = {
  analytics: "/supervisor/operational-intelligence",
  reports: "/supervisor/operational-intelligence",
  intelligence: "/supervisor/operational-intelligence",
  escalation: "/supervisor/escalations",
  workload: "/supervisor/workload-intelligence",
  capacity: "/supervisor/resources",
  tasks: "/supervisor/task-center",
  patients: "/supervisor/patient-list",
  staffing: "/supervisor/workforce-operations",
};

export default async function SupervisorLegacySectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  redirect(Object.hasOwn(LEGACY, section) ? LEGACY[section] : "/supervisor");
}
