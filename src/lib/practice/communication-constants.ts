// CPR-320's vocabularies, in a module with NO server imports so the pages derive their options from the
// same source the engine enforces.

/** How a contact happened IN THE WORLD. Nothing here is a channel this product can send through. */
export const CONTACT_CHANNELS = [
  ["phone", "Phone call"],
  ["in_person", "In person"],
  ["sms_external", "SMS (from a phone, not this product)"],
  ["whatsapp_external", "WhatsApp (from a phone, not this product)"],
  ["letter", "Letter"],
  ["other", "Other"],
] as const;

export const CONTACT_DIRECTIONS = [
  ["outgoing", "We contacted them"],
  ["incoming", "They contacted us"],
] as const;

export const CONTACT_OUTCOMES = [
  ["reached", "Reached them"],
  ["no_answer", "No answer"],
  ["left_message", "Left a message"],
  ["spoke_to_relative", "Spoke to a relative"],
  ["number_unreachable", "Number unreachable"],
] as const;

export const INCOMING_DOC_TYPES = [
  ["lab_result", "Lab result"],
  ["imaging_report", "Imaging report"],
  ["discharge_summary", "Discharge summary"],
  ["referral_response", "Referral response"],
  ["letter", "Letter"],
  ["other", "Other"],
] as const;

/**
 * RECEIVED -> REVIEWED -> ACTIONED, strictly forward, and RECEIVED cannot jump to ACTIONED: the review
 * is a clinical stamp with a name on it, and a register that lets it be skipped is a register that
 * cannot answer "who looked at this result".
 */
export const INCOMING_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ["REVIEWED"],
  REVIEWED: ["ACTIONED"],
  ACTIONED: [],
};

export const INCOMING_PRIORITIES = ["routine", "urgent"] as const;
