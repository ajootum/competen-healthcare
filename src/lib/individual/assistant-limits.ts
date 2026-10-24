// The personal assistant's limits, for the browser as well as the server. This module imports NOTHING:
// a client component (AssistantPanel) reads it, and src/lib/individual/assistant.ts reaches the server-only
// AI and Supabase clients through the Professional record. Importing assistant.ts from the browser put
// next/headers in the client bundle and failed the production build (#45).

export const QUESTION_MAX = 1000;
