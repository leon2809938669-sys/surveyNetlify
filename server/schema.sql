CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unpublished' CHECK (status IN ('published', 'unpublished')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  definition TEXT NOT NULL CHECK (json_valid(definition)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS survey_responses (
  id TEXT PRIMARY KEY NOT NULL,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE RESTRICT,
  survey_version INTEGER NOT NULL CHECK (survey_version > 0),
  respondent_id TEXT,
  submitted_at TEXT NOT NULL,
  response TEXT NOT NULL CHECK (json_valid(response)),
  created_at TEXT NOT NULL,
  submission_key TEXT UNIQUE
) STRICT;

CREATE INDEX IF NOT EXISTS surveys_slug_status_idx ON surveys (slug, status);
CREATE INDEX IF NOT EXISTS survey_responses_survey_idx ON survey_responses (survey_id, submitted_at DESC);
PRAGMA user_version = 1;
