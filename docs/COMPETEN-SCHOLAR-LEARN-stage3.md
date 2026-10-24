# COMPETEN-SCHOLAR: Stage 3 Learn (build record and readiness)

Owner GO 2026-10-24: "Stage 2 Upload accepted. Proceed to Stage 3." The definition, verbatim: "Stage 3 is Learn: the Personal Learning Workspace (explain, summarise, simplify, go deeper, tutor; background beyond the notes labelled; personal AI context; material workspace). Review the existing build and fill the gaps the same way as Stage 2."

**Status:** development authorised. **Production activation not authorised.**

**Migrations:** none. Numbers allocated to this stage (if any) are unused.

## 1. Readiness assessment (read from code)

| Area | Existing (before this build) | Missing | Action |
|---|---|---|---|
| **Explain / summarise / simplify / go deeper** | All four on a section and across notes (S3). Each answer is grounding-checked, cited `[S n]` and AI-labelled; a withheld answer says why. | Plain explanations were often withheld for counting ("three …") or "significant". | **explain v3:** the shared prompt forbids counting listed things and "significant". Every mode builds on it (modes v6). |
| **Tutor** | Per section, multi-turn, browser-held history, every turn checked. | No tutor over a whole material. The student is not told what the tutor knows about them. | **"Tutor me on this material".** The tutor states that it uses the student's programme and practice, and that nothing is saved. |
| **Background beyond the notes** | Split off before the check, checked on its own (no figures or doses), and shown apart as "Beyond your notes". | Cannot be turned off without code. | **Policy `scholar_beyond_notes`** (shown \| off). When off, the prompt is told and anything after the marker is dropped unseen. |
| **Personal AI context** | P1: the tutor gets a words-only view of the student, assembled per request; never grounding, never stored. | Not disclosed to the student. | **Disclosure line** where the tutor is used. |
| **Material workspace** | Sections, links and labels, actions per section, an "Ask about this material" panel, the context stamp. | **"Summarise this material" found nothing.** "Summarise" is a stopword and "material" matched no passage, so the student was told their notes did not cover it. | **Whole-material scope.** The material's sections in order up to 8, and the answer says how much it covered ("Covers sections 1 to 8 of 12 …"). Never a silent sample. |
| **No-code config** | Formats, size and pages (Stage 2). | Which ways of learning are offered; the background switch. | **Policies `scholar_learning_modes` and `scholar_beyond_notes`** on `/super-admin/individual/configuration`, enforced on the server. A mode switched off is refused with 403, and its button is not shown. |
| **Privacy and storage** | Own-row only, quota and consent first, D10 (no explanation or tutor turn stored), audit without text. | — | None. Proven (N1, T2, I1). |

### New Individual policies (CONFIG-002 / WCE)

| Key | Default | Options |
|---|---|---|
| `scholar_learning_modes` | all five | explain, summary, simplify, deeper, tutor |
| `scholar_beyond_notes` | shown | shown, off |

## 2. Verification

- **Unit tests:** Vitest `src/lib` 726 (Individual 284).
- **Static harnesses:**
  - scholar-learning 116/116 (new **K21** with planted red **P38**; K5 follows the background switch);
  - foundation 74/74;
  - config 41/41;
  - ratchet green.
- **Build:** real `next build` compiled, exit 0.
- **Staging over HTTP:** `scholar-learn-harness`, against a staging-pointed dev server with the staging-test legal versions and URLs.
  - **Run 1:** 12 passed, 1 failed (M1, a plain explanation withheld for counting). That led to explain v3.
  - **Run 2:** **ALL GREEN, 13 passed, 0 failed, 1 PEND.**
    - W1: the workspace offers the whole-material actions and the policy's modes.
    - M1: the four modes answer from the notes, cited and labelled.
    - M2: background is apart, labelled, and never for summarise or simplify.
    - X1: "Summarise this material" covers the sections in order and says so. The same request without the scope still found nothing, which is the gap fixed.
    - T1: the tutor works over the whole material for two turns.
    - T2: the personal AI context is used, and the audit holds no text.
    - T3: the tutor states that nothing is saved.
    - R1: an unknown mode is refused.
    - I1: isolation holds.
    - N1: nothing is stored.
    - Z1: fixtures are cleaned up.
    - **PEND R2:** a switched-off mode refused over HTTP. Every mode is on in staging's policy, and the refusal is pinned statically (K21, P38). To prove it live, the owner would switch a mode off on staging.

## 3. Production activation dependencies (none authorised)

1. **Nothing new from Stage 3.** It adds no migration.
2. **It inherits Stage 2's dependencies:**
   - the remaining production migrations, each with its own GO: 394, 402, 403, and 405 if text is wanted;
   - `individual_app` on;
   - the Holdings and Scholar Operator Terms and Privacy **published with production URLs and versions**. Without them, AI help, and so every Stage 3 mode, stays off by design;
   - the catalogue allowlist and a programme;
   - an AI provider and quota (already configured).
3. **Policy defaults** offer every mode with labelled background. HQ can narrow either with no code.
