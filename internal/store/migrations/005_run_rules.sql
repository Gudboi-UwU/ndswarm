-- How many pass/fail rules a finished run was checked against, so the history filter can tell
-- "passed, rules kept" apart from "finished, no rules were set" without parsing summary_json.
ALTER TABLE runs ADD COLUMN rules_count INTEGER NOT NULL DEFAULT 0;
