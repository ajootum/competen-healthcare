export const BENNER_SCALE = [
  { score: 0, label: "Requires Training",  short: "RT",  passing: false, description: "Requires training to perform this activity satisfactorily to participate in the clinical environment." },
  { score: 1, label: "Novice",             short: "N",   passing: false, description: "Can perform this activity with constant supervision and some assistance." },
  { score: 2, label: "Advanced Beginner",  short: "AB",  passing: false, description: "Can perform this activity satisfactorily but requires some supervision and assistance." },
  { score: 3, label: "Competent",          short: "C",   passing: true,  description: "Can perform this activity satisfactorily without supervision and assistance." },
  { score: 4, label: "Competent+",         short: "C+",  passing: true,  description: "Can perform this activity without supervision with more than acceptable speed and quality." },
  { score: 5, label: "Proficient",         short: "P",   passing: true,  description: "Can perform this activity with initiative and adaptability to special problem situations." },
  { score: 6, label: "Expert",             short: "E",   passing: true,  description: "Can perform this activity and can lead others in performing it." },
] as const;

export type BennerScore = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function getBennerLabel(score: number) {
  return BENNER_SCALE.find(b => b.score === Math.round(score)) ?? BENNER_SCALE[0];
}

export function isPassing(score: number) {
  return score >= 3;
}

// Colour used across the UI for each Benner level
export const BENNER_COLORS: Record<number, string> = {
  0: "#ef4444", // red
  1: "#f97316", // orange
  2: "#eab308", // yellow
  3: "#14b8a6", // teal
  4: "#0d9488", // teal-dark
  5: "#3b82f6", // blue
  6: "#8b5cf6", // purple
};
