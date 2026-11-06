// The nine screens. A plain module, not a client one, because the server page also reads it to validate the address.

export type Screen = "calendar" | "today" | "capture" | "commitments" | "worlds" | "plan" | "quadrants" | "review" | "ai";

export const NAV: readonly Screen[] = ["calendar", "today", "capture", "commitments", "worlds", "plan", "quadrants", "review", "ai"];

export const isScreen = (s: string | undefined): s is Screen => !!s && (NAV as readonly string[]).includes(s);
