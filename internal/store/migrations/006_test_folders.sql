-- Groups a project's tests under an optional folder path, e.g. "Orders / Admin".
ALTER TABLE tests ADD COLUMN folder TEXT NOT NULL DEFAULT '';
