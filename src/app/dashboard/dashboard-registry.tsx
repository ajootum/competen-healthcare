import type { ManifestEntry } from "@/lib/orchestration/dashboard-manifest";
import type { WidgetProps } from "./widgets";
import { AiBriefingWidget, PrioritiesWidget, PatientsWidget, TasksWidget, PerformanceWidget, CompetenciesWidget, AiAssistantWidget, ScheduleWidget, NotificationsWidget, MessagesWidget, QuickActionsWidget, WorkspacesWidget } from "./widgets";

// PW-014 WS2 / P3 — the Personal Dashboard widget registry. Maps stable widget keys → their async server
// components, and declares the code-DEFAULT manifest (zone / order / span). resolveDashboardManifest() overlays
// tenant config on this default, so out-of-the-box the dashboard renders exactly as before, and admins can
// disable/reorder via config (PW-AC-06). Keys align to `personal.dashboard.<key>` config paths + widget-catalog.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const WIDGET_COMPONENTS: Record<string, (props: WidgetProps) => Promise<any>> = {
  "ai-briefing": AiBriefingWidget,
  "priorities": PrioritiesWidget,
  "patients": PatientsWidget,
  "tasks": TasksWidget,
  "performance": PerformanceWidget,
  "competencies": CompetenciesWidget,
  "ai-assistant": AiAssistantWidget,
  "schedule": ScheduleWidget,
  "notifications": NotificationsWidget,
  "messages": MessagesWidget,
  "quick-actions": QuickActionsWidget,
  "workspaces": WorkspacesWidget,
};

// Code default — mirrors the former hand-built layout (main 2-col grid + right rail + full-width footer row).
export const DEFAULT_DASHBOARD_MANIFEST: ManifestEntry[] = [
  { key: "ai-briefing", label: "AI Shift Briefing", zone: "main", order: 10, span: 1 },
  { key: "priorities", label: "Today's Priorities", zone: "main", order: 20, span: 1 },
  { key: "patients", label: "My Patients", zone: "main", order: 30, span: 1 },
  { key: "tasks", label: "Tasks Requiring Action", zone: "main", order: 40, span: 1 },
  { key: "performance", label: "My Performance", zone: "main", order: 50, span: 1 },
  { key: "competencies", label: "My Competencies", zone: "main", order: 60, span: 1 },
  { key: "ai-assistant", label: "AI Assistant", zone: "main", order: 70, span: 1 },
  { key: "schedule", label: "Today's Schedule", zone: "rail", order: 10, span: 1 },
  { key: "notifications", label: "Recent Notifications", zone: "rail", order: 20, span: 1 },
  { key: "messages", label: "Messages", zone: "rail", order: 30, span: 1 },
  { key: "quick-actions", label: "Quick Actions", zone: "full", order: 10, span: 1 },
  { key: "workspaces", label: "My Workspaces", zone: "full", order: 20, span: 1 },
];
