-- ============================================================
-- MIGRATION 228: MULTI-HOSPITAL BOOKING (CPR-CAL-001 s5, s21)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THERE ARE TWO PLACE-LIKE THINGS IN THIS PRODUCT AND THEY ARE THE SAME BUILDING.
--
--   practice_location (191)  somewhere the PRACTITIONER works -- their clinic room, and the hospitals
--                            they attend. type already includes 'hospital'.
--   practice_facility (222)  an institution whose NUMBERING a patient carries -- the hospital that
--                            issued their MRN.
--
-- Mulago is both. Left unlinked, a practice ends up with two rows for one hospital and no way to answer
-- the question that matters at the moment of booking: "I am putting this patient into Mulago on
-- Thursday -- what is their Mulago number?" The clerk then reads out whichever MRN is on the record and
-- has no way to tell which hospital issued it.
--
-- So a location may POINT AT the facility it is. Nullable, because a practitioner's own consulting room
-- issues no numbers and is not a facility at all.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

alter table practice_location add column if not exists facility_id uuid references practice_facility(id) on delete set null;
create index if not exists idx_practice_location_facility
  on practice_location(facility_id) where facility_id is not null;

-- ---- Travel ------------------------------------------------------------------------------------------
--
-- THE CONFLICT RULE THAT ONLY EXISTS ONCE THERE IS MORE THAN ONE HOSPITAL.
--
-- Booking 09:00 at Hospital A and 09:30 at Hospital B does not overlap, so the existing double-booking
-- check passes it happily -- and it is impossible, because nobody is in two hospitals half an hour
-- apart. A practitioner who accepts both is a practitioner who will be late for one of them, and the
-- patient at the second one waits without being told why.
--
-- ONE NUMBER PER DESTINATION, deliberately, rather than a matrix of every location to every other. A
-- full travel matrix is the correct model and needs distances this product does not have; "it takes
-- about forty minutes to get to Mulago from anywhere else I work" is a thing a practitioner knows and
-- can type, and it catches the error that matters.

alter table practice_location add column if not exists travel_buffer_minutes integer
  not null default 30 check (travel_buffer_minutes between 0 and 480);

-- ---- Which hospital an appointment is AT ---------------------------------------------------------------
--
-- practice_appointment.location_id has existed since 192 and has never been validated -- the engine
-- writes whatever it is handed, so a booking can name another practice's location. Fixed in the engine
-- (a cross-tenant location is refused), not here: a foreign key already constrains the shape, and the
-- tenancy check needs the caller's workspace, which SQL at write time does not have.

create index if not exists idx_practice_appointment_location
  on practice_appointment(workspace_id, location_id, scheduled_at)
  where location_id is not null;

notify pgrst, 'reload schema';
