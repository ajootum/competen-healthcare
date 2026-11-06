import type { CSSProperties } from "react";

// A tenant's look, as configuration. Colours go through the module's variables, so nothing is hard-coded per tenant.

export type Branding = { productName?: string; logoUrl?: string; primaryColor?: string };

export const brandStyle = (b: Branding): CSSProperties =>
  (b.primaryColor ? { "--lo-primary": b.primaryColor, "--lo-accent": b.primaryColor } : {}) as CSSProperties;
