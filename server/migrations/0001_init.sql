-- 0001_init.sql — initial schema for the mail service
CREATE TYPE mail_status AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE mails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "to"        text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      mail_status NOT NULL DEFAULT 'QUEUED',
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mails_status_idx ON mails (status);
CREATE INDEX mails_created_at_idx ON mails (created_at);
