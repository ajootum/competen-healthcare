/**
 * Assessment Engine
 * Creates and scores clinical assessments.
 */

import { avgToLevel, CompetencyLevel } from "./competency";

export type GradeMap = Record<string, number>;
export type MatchMap = Record<string, "yes" | "no" | "partial" | "">;

export interface SectionResult {
  avg: number;
  level: CompetencyLevel;
  count: number;
  graded: number;
}

export interface MatchSectionResult {
  yes: number;
  no: number;
  partial: number;
  total: number;
  pct: number;
}

export function scoreSection(items: string[], grades: GradeMap): SectionResult | null {
  const graded = items.filter(id => grades[id] !== undefined);
  if (!graded.length) return null;
  const avg = graded.reduce((s, id) => s + grades[id], 0) / graded.length;
  return { avg: parseFloat(avg.toFixed(2)), level: avgToLevel(avg), count: items.length, graded: graded.length };
}

export function scoreDocument(allItemIds: string[], grades: GradeMap): SectionResult | null {
  return scoreSection(allItemIds, grades);
}

export function scoreMatchSection(items: string[], scores: MatchMap): MatchSectionResult {
  let yes = 0, no = 0, partial = 0;
  for (const id of items) {
    const v = scores[id];
    if (v === "yes") yes++;
    else if (v === "no") no++;
    else if (v === "partial") partial++;
  }
  const total = yes + no + partial;
  const pct = total > 0 ? Math.round(((yes + partial * 0.5) / total) * 100) : 0;
  return { yes, no, partial, total, pct };
}

export function scoreMatchDocument(allItemIds: string[], scores: MatchMap): MatchSectionResult {
  return scoreMatchSection(allItemIds, scores);
}

export function gradeLabel(grade: number): string {
  const labels: Record<number, string> = {
    0: "Novice",
    1: "Advanced Beginner I",
    2: "Advanced Beginner II",
    3: "Competent I",
    4: "Competent II",
    5: "Proficient",
    6: "Expert",
  };
  return labels[grade] ?? String(grade);
}
