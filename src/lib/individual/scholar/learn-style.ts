// SCHOLAR-LEARN-STYLE-01 (owner GO, Teaching Style and Practice HFE redesign): THE THREE TEACHING STYLES. Pure; nothing here calls a model.
//
// Learn used to show six teaching approaches as a permanent row of buttons. It now shows ONE choice of three, once per lesson:
//   Explain (default)  clear, structured teaching: the existing standard lesson (no special action)
//   Guide me           the existing `guide` action
//   Challenge me       the existing `challenge` action, with `ask_me` and `teach_back` as its follow-on steps
// Everything else (High-yield, Simplify, Summarise, ...) sits in a discreet More menu; Explain my mistake appears on its own
// only after a wrong check. Every choice runs the SAME code path the old button did: the action registry, the AI activity
// mapping (config.ts TEACHING_AI_ACTIVITY), fair-use metering and model eligibility are unchanged. This file only decides
// WHAT is shown and what each choice runs.
//
// The learner's chosen style is kept per learning session in the existing 790 position object (`unfinished.style`, one
// letter: g or c; Explain is the default and is not stored). No schema change.

export const STYLES = ["explain", "guide", "challenge"] as const;
export type TeachingStyle = (typeof STYLES)[number];
/** The most primary choices a section ever shows. A hard rule, enforced in styleChoices. */
export const PRIMARY_MAX = 3;

export const STYLE_LABEL: Record<TeachingStyle, string> = { explain: "Explain", guide: "Guide me", challenge: "Challenge me" };
export const STYLE_BLURB: Record<TeachingStyle, string> = {
  explain: "Clear, structured teaching with explanations, examples and key points.",
  guide: "Step-by-step learning with questions, prompts and guided reasoning.",
  challenge: "Questioning, teach-back and progressively harder reasoning.",
};
/** The follow-on steps inside Challenge me, and the words on their buttons. */
export const FOLLOW_ON_LABEL = { ask_me: "Ask me a question", teach_back: "Teach it back" } as const;
export type FollowOnAction = keyof typeof FOLLOW_ON_LABEL;

/** The three scholar_learn_style_* / more_menu policy values. */
export type StylePolicy = { guide: "on" | "off"; challenge: "on" | "off"; moreMenu: "on" | "off" };
export const STYLE_DEFAULTS: StylePolicy = { guide: "on", challenge: "on", moreMenu: "on" };

/**
 * What the page knows. `actions`: the learning actions policy offers. `consent`: AI help is on for the learner.
 * `reasonOf(action)`: why that action's AI activity is unavailable (the standing's reason code, as aiReasonCopy reads it), or null.
 */
export type StyleAvailability = { actions: readonly string[]; consent: boolean; reasonOf: (action: string) => string | null };

export type FollowOn = { action: FollowOnAction; label: string; disabled: boolean; reason: string | null };
export type StyleChoice = {
  style: TeachingStyle; label: string; description: string;
  /** The existing action this choice runs (null: Explain, the lesson itself). */
  action: "guide" | "challenge" | null;
  /** Challenge me only: Ask me / Teach back, offered inside it. */
  followOns: FollowOn[];
  /** Visible but not usable: AI help is off or the activity is unavailable. `reason` is the code for aiReasonCopy (null with no consent: the page says so). */
  disabled: boolean; reason: string | null;
};

const off = (av: StyleAvailability, action: string) => (av.consent ? av.reasonOf(action) : null);

/**
 * Pure. The primary choices to show, in order (never more than PRIMARY_MAX). Explain is always there. Guide me / Challenge me
 * are there only where BOTH the style policy and the learning-actions policy offer them; a choice whose activity is off or
 * unavailable stays visible, disabled, with the reason.
 */
export function styleChoices(policy: Pick<StylePolicy, "guide" | "challenge">, av: StyleAvailability): StyleChoice[] {
  const out: StyleChoice[] = [{ style: "explain", label: STYLE_LABEL.explain, description: STYLE_BLURB.explain, action: null, followOns: [], disabled: false, reason: null }];
  if (policy.guide === "on" && av.actions.includes("guide")) {
    const reason = off(av, "guide");
    out.push({ style: "guide", label: STYLE_LABEL.guide, description: STYLE_BLURB.guide, action: "guide", followOns: [], disabled: !av.consent || !!reason, reason });
  }
  if (challengeShown(policy, av)) {
    const reason = off(av, "challenge");
    const followOns = (["ask_me", "teach_back"] as const).filter(a => av.actions.includes(a)).map((a): FollowOn => {
      const r = off(av, a);
      return { action: a, label: FOLLOW_ON_LABEL[a], disabled: !av.consent || !!r, reason: r };
    });
    out.push({ style: "challenge", label: STYLE_LABEL.challenge, description: STYLE_BLURB.challenge, action: "challenge", followOns, disabled: !av.consent || !!reason, reason });
  }
  return out.slice(0, PRIMARY_MAX);
}

function challengeShown(policy: Pick<StylePolicy, "challenge">, av: StyleAvailability) {
  return policy.challenge === "on" && av.actions.includes("challenge");
}

/** An item in the More menu. `classic`: a Learn action asked of the lesson (Simplify, Summarise ...). `approach`: opens a panel (High-yield ...). */
export type MoreItem = { key: string; action: string; label: string; kind: "classic" | "approach"; disabled: boolean; reason: string | null };
const MORE_LABEL: Record<string, string> = {
  teach: "Teach me", explain: "Explain this", simplify: "Simplify", summary: "Summarise", high_yield: "High-yield", ask_me: "Ask me a question", teach_back: "Teach it back",
};

/**
 * Pure. The More menu: the other existing actions that are not one of the three styles. `classic` is the lesson's other Learn actions
 * (already without the primary way in, Go deeper and Examples, which live in the activity row). High-yield is always here.
 * Ask me / Teach back are here only when Challenge me is not shown (they live inside it otherwise), so no capability is lost.
 * Explain my mistake is never here: it appears on its own after a wrong check (mistakeOffer). Empty when the menu is switched off.
 */
export function moreItems(policy: StylePolicy, av: StyleAvailability, classic: readonly string[]): MoreItem[] {
  if (policy.moreMenu !== "on") return [];
  const keys: { action: string; kind: "classic" | "approach" }[] = [
    ...classic.filter(a => av.actions.includes(a)).map(action => ({ action, kind: "classic" as const })),
    ...(av.actions.includes("high_yield") ? [{ action: "high_yield", kind: "approach" as const }] : []),
    ...(challengeShown(policy, av) ? [] : (["ask_me", "teach_back"] as const).filter(a => av.actions.includes(a)).map(action => ({ action, kind: "approach" as const }))),
  ];
  return keys.map(({ action, kind }) => {
    const reason = off(av, action);
    return { key: action, action, label: MORE_LABEL[action] ?? action, kind, disabled: !av.consent || !!reason, reason };
  });
}

/** Pure. Explain my mistake: offered only after a partly / not-yet check whose answer is kept, and only where policy offers the action. */
export function mistakeOffer(av: StyleAvailability, verdict: string | null, hasLastCheck: boolean): { show: boolean; disabled: boolean; reason: string | null } {
  const show = av.actions.includes("mistake") && (verdict === "partly" || verdict === "not_yet") && hasLastCheck;
  const reason = show ? off(av, "mistake") : null;
  return { show, disabled: show && (!av.consent || !!reason), reason };
}

// ── PERSISTENCE (790 unfinished.style) ──

const TO_CODE: Record<TeachingStyle, "g" | "c" | undefined> = { explain: undefined, guide: "g", challenge: "c" };
/** Pure. The short code stored for a style (Explain is the default and is not stored). */
export const styleCode = (s: TeachingStyle): "g" | "c" | undefined => TO_CODE[s];
/** Pure. The style a stored code means; anything unknown is Explain. */
export const styleFromCode = (c: unknown): TeachingStyle => (c === "g" ? "guide" : c === "c" ? "challenge" : "explain");
/** Pure. A stored code, kept only if it is one of ours. */
export const cleanStyleCode = (c: unknown): "g" | "c" | undefined => (c === "g" || c === "c" ? c : undefined);

/** Pure. The style actually in use: the learner's, unless that choice is hidden or disabled now (then Explain; the stored choice is kept). */
export function effectiveStyle(chosen: TeachingStyle, choices: readonly StyleChoice[]): TeachingStyle {
  const c = choices.find(x => x.style === chosen);
  return c && !c.disabled ? chosen : "explain";
}
