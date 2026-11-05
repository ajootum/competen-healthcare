// The two Standard Recall buttons and the SM-2 quality each one sends. Pure and dependency-free so a client component can
// import it (flashcards.ts pulls in server-only code). flashcards.ts re-exports both names; this is the one definition.
//   "Didn't remember / Review sooner"  = quality 1  (a lapse: tomorrow, ease down 0.54)
//   "Remembered / Review later"        = quality 4  (a recall: 1, 6, then x ease, ease unchanged)
export const RECALL = {
  again: { quality: 1, label: "Didn't remember", sub: "Review sooner", key: "1" },
  remembered: { quality: 4, label: "Remembered", sub: "Review later", key: "2" },
} as const;
export type RecallChoice = keyof typeof RECALL;
