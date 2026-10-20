-- "Sorun bildir": a teacher can add up to three screenshots to a report (small JPEG pictures,
-- kept with the report). Needs 20261003_feedback.sql first. Safe to run more than once.
alter table public.feedback add column if not exists screenshots jsonb
  check (screenshots is null or (jsonb_typeof(screenshots) = 'array' and jsonb_array_length(screenshots) <= 3
    and octet_length(screenshots::text) <= 1500000));
