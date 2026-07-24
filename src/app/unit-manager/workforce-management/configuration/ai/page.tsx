import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// AI & Optimisation config (UMW-WFM-009 §19).
export default function AiConfig() {
  return <ConfigPlaceholder
    title="Configuration · AI & Optimisation"
    subtitle="Objective weights, confidence, automation boundaries, explainability and bias controls."
    banner="AI/optimisation configuration needs an AI-config store. The scheduling engine's objective weights (coverage/competency/fairness/cost) are applied today via the solver + WPS-001 cost params; configurable AI mode, confidence thresholds, bias monitoring and model governance are next-phase (§19). AI recommends within configured rules — it never replaces the accountable manager (§19)."
    sections={[
      { heading: "Controls (§19)", items: ["AI mode (off→auto-execute)", "Confidence threshold", "Objective weights", "Hard constraints", "Soft constraints", "Recommendation limit", "Prediction horizon", "Explainability", "Human approval"] },
      { heading: "Governance", items: ["Bias monitoring (protected dimensions)", "Fairness measures", "Learning mode", "Simulation mode", "Override policy", "Model version + validation + rollback"] },
      { heading: "Accountability", items: ["No forced automatic assignment/publication", "AI within configured rules only", "Explainable rule trace"] },
    ]}
    footer="AI & Optimisation config (UMW-WFM-009 §19) — next-phase pending an AI-config store. The scheduling solver + Explainable AI run in the Scheduling Engine today."
  />;
}
