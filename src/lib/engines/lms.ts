/**
 * LMS Engine
 * Delivers and tracks learning content.
 */

export type CourseLevel = "beginner" | "intermediate" | "advanced";

export interface CourseProgress {
  course_id: string;
  user_id: string;
  progress_pct: number;
  completed_at: string | null;
  cpd_points: number;
}

export function isCompleted(progress: CourseProgress): boolean {
  return progress.completed_at !== null || progress.progress_pct >= 100;
}

export function totalCpdEarned(progressList: CourseProgress[]): number {
  return progressList
    .filter(p => isCompleted(p))
    .reduce((s, p) => s + p.cpd_points, 0);
}

export function completionRate(progressList: CourseProgress[]): number {
  if (!progressList.length) return 0;
  return Math.round((progressList.filter(p => isCompleted(p)).length / progressList.length) * 100);
}

export function levelOrder(level: CourseLevel): number {
  return { beginner: 0, intermediate: 1, advanced: 2 }[level];
}

export function nextLesson(progress_pct: number, totalLessons: number): number {
  return Math.floor((progress_pct / 100) * totalLessons) + 1;
}

export function levelColor(level: CourseLevel): string {
  return {
    beginner:     "bg-green-100 text-green-700",
    intermediate: "bg-amber-100 text-amber-700",
    advanced:     "bg-red-100 text-red-700",
  }[level];
}
