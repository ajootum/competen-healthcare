import { LIFECYCLE, type Lifecycle } from "../research/registry";

// ── THE DOCUMENT ENGINE REGISTRY ── COMPETEN-DIG-001 s4, PHASE 1 ──────────────────────────────────────────────────────────
//
// Built the way the research source registry is (src/lib/holdings/research/registry.ts): each engine is a record in a CONFIG-002
// document (workspace_config_overrides, scope platform / document-intelligence, path document.registry), edited in HQ, versioned and audited
// by that mechanism, with no migration and no redeploy. The same lifecycle: registration, integration, approval and activation are separate.
// The code holds only what must stay code: the adapters that exist, and the rules below.
//
// ⚠ NOTHING IN THE APP IMPORTS THIS YET. Phase 1 uses it in the proof of concept only.

export const DOCUMENT_SCOPE = { scopeType: "platform", scopeRef: "document-intelligence" } as const;
export const DOCUMENT_REGISTRY_PATH = "document.registry";
export { LIFECYCLE };

export const FORMATS = ["pptx", "docx", "pdf", "image", "text"] as const;
export type Format = (typeof FORMATS)[number];

/** What an engine can do. A request names what it needs. */
export const ENGINE_CAPABILITIES = ["text", "structure", "tables", "charts", "diagrams", "figures", "render_pages", "ocr", "page_recovery", "interpretation"] as const;
export type EngineCapability = (typeof ENGINE_CAPABILITIES)[number];

/** Where the learner's file goes. Anything other than our own function or a container we run is outside Competen. */
export type DataLocation = "in_function" | "own_container" | "approved_external";

/**
 * ⚠ THE ADAPTERS THAT EXIST IN CODE. An engine with no adapter here can never be selected, whatever a document says.
 * Phase 1 adapters live in the proof of concept. Phase 2 moves those that pass into the app.
 */
export const DOCUMENT_ADAPTERS = ["native_drawingml", "existing_drawingml", "unpdf", "mammoth", "utf8_text", "libreoffice_wasm_pdfium", "pdfium", "metered_ai_transcription", "markitdown"] as const;
export type DocumentAdapter = (typeof DOCUMENT_ADAPTERS)[number];
export const hasDocumentAdapter = (id: string): id is DocumentAdapter => (DOCUMENT_ADAPTERS as readonly string[]).includes(id);

export type EngineRecord = {
  id: string;
  name: string;
  status: Lifecycle;
  /** Bumped by every saved change. */
  version: number;
  /** The engine's own version: changing it invalidates what it produced. */
  engineVersion: string;
  formats: Format[];
  capabilities: EngineCapability[];
  /** Lower first among engines that are otherwise suitable. */
  priority: number;
  /** May be tried after another engine fails. */
  fallbackEligible: boolean;
  /** Can redo only named units, instead of the whole file. */
  unitRecovery: boolean;
  limits: { maxMemoryMb: number; timeoutMs: number; stallMs: number | null; maxRetries: number; maxConcurrent: number };
  /** Declared, then replaced by measured figures. Null: not measured. Never zero for unknown. */
  cost: { estimatedMemoryMb: number; estimatedSeconds: number; measuredPeakMb: number | null; measuredSeconds: number | null; usdPerDocument: number | null };
  quality: { minTextRecall: number; keepsLayout: boolean; lossless: boolean };
  location: DataLocation;
  /** True when using it spends AI allowance. Only ever on the learner's own request. */
  usesAi: boolean;
  /** Needs the person's AI consent. */
  needsConsent: boolean;
  /** Set only by an owner approval, per engine, naming the data it may receive. */
  externalApproval: { by: string; at: string; scope: string } | null;
  retiredReason: string | null;
};

export type ProcessingRequest = {
  format: Format;
  needs: readonly EngineCapability[];
  /** The learner asked for this, and has consented where consent is needed. Automatic processing never reaches an AI engine. */
  learnerRequestedAi: boolean;
  learnerConsented: boolean;
};

export type EngineHealth = { open: boolean; failures: number; until: number | null };

/**
 * ⚠ THE ONE GATE. Null: this engine may run this request. A status or an approval written into a document by hand does not get past
 * the adapter check, and an external engine needs its own named approval. There is no setting that lets an internal failure move a
 * learner's file outside Competen: a fallback passes through this same gate.
 */
export function refusal(e: EngineRecord, r: ProcessingRequest, health: EngineHealth | null): string | null {
  if (e.status !== "active") return "not_active";
  if (!hasDocumentAdapter(e.id)) return "no_adapter";
  if (!e.formats.includes(r.format)) return "format";
  if (e.location === "approved_external" && !e.externalApproval) return "external_not_approved";
  if (e.usesAi && !r.learnerRequestedAi) return "ai_not_requested";
  if (e.needsConsent && !r.learnerConsented) return "no_consent";
  if (health?.open) return "circuit_open";
  return null;
}

const NOT_MEASURED = { measuredPeakMb: null, measuredSeconds: null, usdPerDocument: null };

/**
 * The first registry, as it would be seeded in Phase 2: nothing active that is not already running in production, and the rendering engine stays
 * behind its own policy. Figures from COMPETEN-DIG-001 benchmark results (docs/evidence/COMPETEN-DIG-001).
 */
export const SEED_ENGINES: readonly EngineRecord[] = [
  {
    id: "native_drawingml", name: "Competen native PowerPoint reader", status: "active", version: 1, engineVersion: "pptx-canonical@1", formats: ["pptx"],
    capabilities: ["text", "structure", "tables", "charts", "diagrams", "figures"], priority: 10, fallbackEligible: false, unitRecovery: true,
    limits: { maxMemoryMb: 512, timeoutMs: 30_000, stallMs: null, maxRetries: 1, maxConcurrent: 20 },
    cost: { estimatedMemoryMb: 200, estimatedSeconds: 2, ...NOT_MEASURED }, quality: { minTextRecall: 0.98, keepsLayout: false, lossless: true },
    location: "in_function", usesAi: false, needsConsent: false, externalApproval: null, retiredReason: null,
  },
  {
    id: "existing_drawingml", name: "Production PowerPoint text reader (extract.ts), as the fallback", status: "active", version: 1, engineVersion: "pptx-drawingml@1", formats: ["pptx"],
    capabilities: ["text"], priority: 20, fallbackEligible: true, unitRecovery: true,
    limits: { maxMemoryMb: 512, timeoutMs: 30_000, stallMs: null, maxRetries: 1, maxConcurrent: 20 },
    cost: { estimatedMemoryMb: 200, estimatedSeconds: 1, ...NOT_MEASURED }, quality: { minTextRecall: 0.98, keepsLayout: false, lossless: true },
    location: "in_function", usesAi: false, needsConsent: false, externalApproval: null, retiredReason: null,
  },
  {
    id: "unpdf", name: "Competen native PDF reader (pdf.js)", status: "active", version: 1, engineVersion: "unpdf@1.8.1", formats: ["pdf"],
    capabilities: ["text", "page_recovery"], priority: 10, fallbackEligible: true, unitRecovery: true,
    limits: { maxMemoryMb: 512, timeoutMs: 30_000, stallMs: null, maxRetries: 1, maxConcurrent: 20 },
    cost: { estimatedMemoryMb: 200, estimatedSeconds: 2, ...NOT_MEASURED }, quality: { minTextRecall: 0.95, keepsLayout: false, lossless: true },
    location: "in_function", usesAi: false, needsConsent: false, externalApproval: null, retiredReason: null,
  },
  {
    id: "mammoth", name: "Competen native Word reader (mammoth)", status: "active", version: 1, engineVersion: "mammoth@1.12", formats: ["docx"],
    capabilities: ["text", "structure", "tables"], priority: 10, fallbackEligible: false, unitRecovery: false,
    limits: { maxMemoryMb: 512, timeoutMs: 30_000, stallMs: null, maxRetries: 1, maxConcurrent: 20 },
    cost: { estimatedMemoryMb: 200, estimatedSeconds: 2, ...NOT_MEASURED }, quality: { minTextRecall: 0.98, keepsLayout: false, lossless: true },
    location: "in_function", usesAi: false, needsConsent: false, externalApproval: null, retiredReason: null,
  },
  {
    id: "libreoffice_wasm_pdfium", name: "Whole-slide drawing (SCHOLAR-VISUAL-001)", status: "evaluated", version: 1, engineVersion: "libreoffice-wasm-2.7.2+pdfium-3.0.0-lossless", formats: ["pptx", "docx"],
    capabilities: ["render_pages", "text", "page_recovery"], priority: 50, fallbackEligible: true, unitRecovery: true,
    limits: { maxMemoryMb: 2048, timeoutMs: 280_000, stallMs: 30_000, maxRetries: 2, maxConcurrent: 3 },
    cost: { estimatedMemoryMb: 2050, estimatedSeconds: 35, ...NOT_MEASURED }, quality: { minTextRecall: 0.9, keepsLayout: true, lossless: true },
    location: "in_function", usesAi: false, needsConsent: false, externalApproval: null, retiredReason: null,
  },
  {
    id: "pdfium", name: "PDF page drawing (SCHOLAR-VISUAL-001)", status: "evaluated", version: 1, engineVersion: "pdfium-3.0.0-lossless", formats: ["pdf"],
    capabilities: ["render_pages", "page_recovery"], priority: 20, fallbackEligible: true, unitRecovery: true,
    limits: { maxMemoryMb: 1024, timeoutMs: 120_000, stallMs: 30_000, maxRetries: 2, maxConcurrent: 5 },
    cost: { estimatedMemoryMb: 400, estimatedSeconds: 10, ...NOT_MEASURED }, quality: { minTextRecall: 0, keepsLayout: true, lossless: true },
    location: "in_function", usesAi: false, needsConsent: false, externalApproval: null, retiredReason: null,
  },
  {
    id: "metered_ai_transcription", name: "AI reading of a picture, on the learner's request", status: "active", version: 1, engineVersion: "exam-transcribe-v1", formats: ["pptx", "pdf", "image"],
    capabilities: ["ocr", "interpretation", "page_recovery"], priority: 90, fallbackEligible: false, unitRecovery: true,
    limits: { maxMemoryMb: 512, timeoutMs: 120_000, stallMs: null, maxRetries: 1, maxConcurrent: 5 },
    cost: { estimatedMemoryMb: 300, estimatedSeconds: 20, ...NOT_MEASURED }, quality: { minTextRecall: 0, keepsLayout: false, lossless: false },
    location: "approved_external", usesAi: true, needsConsent: true, externalApproval: { by: "owner", at: "existing Scholar AI consent and provider registry", scope: "Pictures the learner asks to have read, under AI consent" }, retiredReason: null,
  },
];
