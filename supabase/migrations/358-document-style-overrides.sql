-- 358 WHAT ONE DOCUMENT CHANGED ABOUT THE PRACTICE STYLE
--
-- CPR-DOC-CONFIG-001 sections 2, 7 and 12, Phase 3.
--
-- Section 2 defines five levels, resolved single-document -> document-type ->
-- document-family -> Practice default -> platform baseline. Four of those five
-- already have a home: the baseline is a constant, the Practice default is a
-- published style profile (357), and the family and type overrides live INSIDE
-- that profile's tokens.
--
-- WHY FAMILY AND TYPE OVERRIDES ARE NOT TABLES. They belong to the practice
-- style, not beside it. Keeping them in the profile means one artifact is
-- published, one version is stamped, and one id is pinned onto a document -- so
-- section 11's "existing signed/issued documents must never be visually
-- rewritten" covers the overrides for free. Two tables would need two publishes,
-- two versions and a rule for what happens when they disagree.
--
-- THIS COLUMN IS THE FIFTH LEVEL, AND IT IS THE ONE THAT CANNOT LIVE THERE.
-- Section 12: "A practitioner preparing an individual document may still make
-- bounded presentation changes without changing the Practice default", and "A
-- one-document customization must not silently overwrite the Practice-wide
-- configuration." A per-document change stored in the practice profile would do
-- exactly that. It belongs on the document.
--
-- BOUNDED, NOT ARBITRARY. What may be overridden per document is a small subset
-- validated in the application before it is written -- section order and the
-- visibility of sections that are permitted to be hidden. It is not a second
-- style: a practitioner cannot repaint one letter, and nothing here can hide
-- clinical content, which section 7 places outside styling altogether
-- ("Clinical disclosure is selected during document generation, not globally
-- hidden by styling").
--
-- NULL IS THE NORMAL CASE. A document with no overrides -- which is every
-- document that exists today and most that ever will -- resolves to the practice
-- style exactly as it does now.

alter table practice_clinical_document
  add column if not exists style_overrides jsonb;

notify pgrst, 'reload schema';
