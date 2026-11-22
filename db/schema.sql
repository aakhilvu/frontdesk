-- Frontdesk schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS agents (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  email text NOT NULL UNIQUE
);

-- Days nobody works (festival holidays). Weekends are handled in code.
CREATE TABLE IF NOT EXISTS holidays (
  day  date PRIMARY KEY,
  name text NOT NULL
);

-- Current state of each ticket. This is the "how it looks right now" part.
CREATE TABLE IF NOT EXISTS tickets (
  id             serial PRIMARY KEY,
  customer_name  text NOT NULL,
  customer_email text NOT NULL,
  subject        text NOT NULL,
  description    text NOT NULL,
  priority       text NOT NULL CHECK (priority IN ('urgent', 'medium', 'low')),
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'waiting_customer', 'resolved', 'closed')),
  assignee_id    integer REFERENCES agents(id),
  status_since   timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status);

-- Messages visible to the customer. Internal notes are NOT stored here.
CREATE TABLE IF NOT EXISTS messages (
  id         bigserial PRIMARY KEY,
  ticket_id  integer NOT NULL REFERENCES tickets(id),
  direction  text NOT NULL CHECK (direction IN ('agent', 'customer')),
  author_id  integer REFERENCES agents(id),            -- null for customer messages
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS messages_ticket_idx ON messages (ticket_id);

-- Team-only notes live in their own table so that no customer-facing query can ever reach them.
CREATE TABLE IF NOT EXISTS internal_notes (
  id         bigserial PRIMARY KEY,
  ticket_id  integer NOT NULL REFERENCES tickets(id),
  author_id  integer NOT NULL REFERENCES agents(id),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS internal_notes_ticket_idx ON internal_notes (ticket_id);

-- The history: what happened, when, and who did it. Append-only.
-- Note bodies are never copied in here, only a reference to the note.
CREATE TABLE IF NOT EXISTS ticket_events (
  id         bigserial PRIMARY KEY,
  ticket_id  integer NOT NULL REFERENCES tickets(id),
  type       text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('agent', 'customer', 'system')),
  actor_id   integer REFERENCES agents(id),
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events (ticket_id, id);

-- Nobody can change or delete the record later, not even the application.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ticket_events', 'messages', 'internal_notes'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_no_update_delete') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
                      FOR EACH ROW EXECUTE FUNCTION forbid_change()', t || '_no_update_delete', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_no_truncate') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I
                      FOR EACH STATEMENT EXECUTE FUNCTION forbid_change()', t || '_no_truncate', t);
    END IF;
  END LOOP;
END $$;

-- Placeholder holiday list (fixed-date public holidays). Replace with Arvo's real calendar.
INSERT INTO holidays (day, name) VALUES
  ('2026-12-25', 'Christmas'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-26', 'Republic Day'),
  ('2027-08-15', 'Independence Day'),
  ('2027-10-02', 'Gandhi Jayanti'),
  ('2027-12-25', 'Christmas')
ON CONFLICT DO NOTHING;
