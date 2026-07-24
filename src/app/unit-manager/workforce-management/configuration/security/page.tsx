import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Security & Delegated Administration config (UMW-WFM-009 §21).
export default function SecurityConfig() {
  return <ConfigPlaceholder
    title="Configuration · Security & Delegated Administration"
    subtitle="Roles, permissions, scope, override rights and support access."
    banner="Delegated-administration + override-boundary configuration needs a security-config store. Role-based access + scope are enforced today via Platform IAM and per-page role gates (hospital_admin/super_admin); the configurable permission matrix, override boundaries and time-bound support access are next-phase (§21). Platform staff cannot change tenant policy by default (§4.1)."
    sections={[
      { heading: "Access controls (§21)", items: ["Role-based access (action/domain/scope)", "Attribute-based access", "Delegated administration", "Override boundaries", "Sensitive-value masking", "Support access (time-limited)", "Export controls", "Segregation of duties", "Session assurance / MFA"] },
      { heading: "Override model (§22)", items: ["Inherited value", "Local override (reason+owner)", "Locked value", "Bounded override", "Temporary override (expiry)", "Reset to inherited"] },
      { heading: "Widget (CFG-SEC-01)", items: ["Permission matrix", "Actions by role + scope", "Compare roles", "Export review"] },
    ]}
    footer="Security & Delegated Administration config (UMW-WFM-009 §21-22) — next-phase pending a security-config store."
  />;
}
