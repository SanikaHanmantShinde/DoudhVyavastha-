ALTER TABLE producers
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

ALTER TABLE milk_entries
  ADD COLUMN session_date date,
  ADD COLUMN session_type text CHECK (session_type IN ('MORNING', 'EVENING'));

CREATE UNIQUE INDEX milk_entries_session_producer_unique
  ON milk_entries (dairy_id, producer_id, session_date, session_type, milk_type)
  WHERE session_type IS NOT NULL;

CREATE TABLE collection_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dairy_id uuid NOT NULL REFERENCES dairies(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  session_type text NOT NULL CHECK (session_type IN ('MORNING', 'EVENING')),
  status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  started_by uuid NOT NULL REFERENCES users(id),
  closed_by uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (dairy_id, session_date, session_type),
  CHECK ((status = 'OPEN' AND closed_at IS NULL AND closed_by IS NULL)
      OR (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL))
);

CREATE INDEX collection_sessions_dairy_date_idx
  ON collection_sessions (dairy_id, session_date DESC, session_type);
