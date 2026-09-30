-- How many pass/fail rules a finished run was checked against, so the history filter can tell
-- "passed, rules kept" apart from "finished, no rules were set" without parsing summary_json.
ALTER TABLE runs ADD COLUMN rules_count INTEGER NOT NULL DEFAULT 0;

-- Backfill runs that finished before this column existed, so they don't all read as "no rules"
-- and disappear from the Passed filter. summary_json.thresholds is the rule results recorded
-- at finish time; its length is the rule count (0 or missing when the test had none).
UPDATE runs SET rules_count = COALESCE(json_array_length(json_extract(summary_json, '$.thresholds')), 0)
WHERE status = 'finished' AND summary_json IS NOT NULL;
