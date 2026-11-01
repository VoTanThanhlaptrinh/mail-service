-- 0002_api_keys_usage_audit.sql
-- API key registry, per-key email usage ledger and an append-only audit trail.
--
-- Design notes:
--   * api_keys holds only a SHA-256 hash of the secret; the plaintext key is
--     returned exactly once by the registration endpoint.
--   * api_key_usage_logs is the per-key history of email calls. It is a ledger:
--     rows are append-only (UPDATE/DELETE blocked by a trigger).
--   * audit_logs records every lifecycle change of an api_key (create, update,
--     revoke, rotate, soft delete) with actor / request metadata. The rows are
--     written by a trigger, so writes coming from scripts or SQL clients are
--     captured too.
--   * The application publishes the actor and request metadata through the
--     transaction-local settings app.actor, app.request_id, app.ip and
--     app.user_agent (see server/src/lib/audit.ts).

CREATE TYPE api_key_status AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE api_key_usage_outcome AS ENUM ('SUCCESS', 'FAILED', 'REJECTED');

CREATE TABLE api_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  description    text,
  key_prefix     text NOT NULL,
  key_last4      text NOT NULL,
  key_hash       text NOT NULL,
  status         api_key_status NOT NULL DEFAULT 'ACTIVE',
  scopes         text[] NOT NULL DEFAULT ARRAY['mail:send']::text[],
  expires_at     timestamptz,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL DEFAULT 'system',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL DEFAULT 'system',
  deleted_at     timestamptz,
  CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash),
  CONSTRAINT api_keys_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT api_keys_scopes_not_empty CHECK (cardinality(scopes) > 0),
  CONSTRAINT api_keys_revoked_consistency CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE INDEX api_keys_status_created_idx ON api_keys (status, created_at DESC);
CREATE INDEX api_keys_created_at_idx ON api_keys (created_at DESC);
CREATE INDEX api_keys_expires_at_idx ON api_keys (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX api_keys_deleted_at_idx ON api_keys (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE api_key_usage_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id    uuid NOT NULL REFERENCES api_keys (id) ON DELETE RESTRICT,
  mail_id       uuid REFERENCES mails (id) ON DELETE SET NULL,
  action        text NOT NULL DEFAULT 'mail.send',
  outcome       api_key_usage_outcome NOT NULL,
  http_method   text NOT NULL,
  path          text NOT NULL,
  status_code   integer,
  error_code    text,
  error_message text,
  duration_ms   integer,
  request_id    text,
  ip_address    inet,
  user_agent    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_key_usage_logs_status_code_range CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  CONSTRAINT api_key_usage_logs_duration_non_negative CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX api_key_usage_logs_key_created_idx ON api_key_usage_logs (api_key_id, created_at DESC);
CREATE INDEX api_key_usage_logs_mail_idx ON api_key_usage_logs (mail_id) WHERE mail_id IS NOT NULL;
CREATE INDEX api_key_usage_logs_created_at_idx ON api_key_usage_logs (created_at DESC);
CREATE INDEX api_key_usage_logs_outcome_idx ON api_key_usage_logs (outcome, created_at DESC);
CREATE INDEX api_key_usage_logs_request_id_idx ON api_key_usage_logs (request_id) WHERE request_id IS NOT NULL;

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  actor       text NOT NULL DEFAULT 'system',
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id  text,
  ip_address  inet,
  user_agent  text
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_occurred_at_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Audit columns: created_at / created_by / updated_at / updated_by
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_audit_actor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor text := NULLIF(current_setting('app.actor', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by := COALESCE(v_actor, NULLIF(NEW.created_by, ''), 'system');
    NEW.updated_at := COALESCE(NEW.updated_at, now());
    NEW.updated_by := COALESCE(v_actor, NULLIF(NEW.updated_by, ''), 'system');
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := COALESCE(v_actor, OLD.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER api_keys_touch_audit_fields
  BEFORE INSERT OR UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION fn_set_audit_actor();

-- ---------------------------------------------------------------------------
-- Audit trail: every meaningful api_keys change becomes an audit_logs row.
-- Timestamps and the volatile last_used_at counter are ignored for the
-- "did anything change?" check so that usage bookkeeping does not spam the log.
-- The secret hash is never copied into the audit trail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_api_keys() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_action     text;
  v_entity_id  text;
  v_changes    jsonb;
  v_actor      text := COALESCE(NULLIF(current_setting('app.actor', true), ''), 'system');
  v_request_id text := NULLIF(current_setting('app.request_id', true), '');
  v_ip         text := NULLIF(current_setting('app.ip', true), '');
  v_user_agent text := NULLIF(current_setting('app.user_agent', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'CREATE';
    v_entity_id := NEW.id::text;
    v_changes := jsonb_build_object('after', to_jsonb(NEW) - 'key_hash');
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - 'key_hash' - 'updated_at' - 'updated_by' - 'last_used_at')
       IS NOT DISTINCT FROM
       (to_jsonb(NEW) - 'key_hash' - 'updated_at' - 'updated_by' - 'last_used_at') THEN
      RETURN NULL;
    END IF;

    v_entity_id := NEW.id::text;
    v_action := CASE
      WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'DELETE'
      WHEN NEW.status = 'REVOKED' AND OLD.status <> 'REVOKED' THEN 'REVOKE'
      WHEN OLD.key_hash IS DISTINCT FROM NEW.key_hash THEN 'ROTATE'
      ELSE 'UPDATE'
    END;
    v_changes := jsonb_build_object(
      'before', to_jsonb(OLD) - 'key_hash',
      'after', to_jsonb(NEW) - 'key_hash'
    );
    IF OLD.key_hash IS DISTINCT FROM NEW.key_hash THEN
      v_changes := v_changes || jsonb_build_object('key_rotated', true);
    END IF;
  ELSE
    v_action := 'DELETE';
    v_entity_id := OLD.id::text;
    v_changes := jsonb_build_object('before', to_jsonb(OLD) - 'key_hash');
  END IF;

  INSERT INTO audit_logs (entity, entity_id, action, actor, changes, request_id, ip_address, user_agent)
  VALUES (
    'api_key',
    v_entity_id,
    v_action,
    v_actor,
    v_changes,
    v_request_id,
    CASE WHEN v_ip ~ '^[0-9A-Fa-f:.]+$' THEN v_ip::inet END,
    v_user_agent
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER api_keys_audit_changes
  AFTER INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION fn_audit_api_keys();

-- ---------------------------------------------------------------------------
-- Append-only guards for the usage ledger and the audit trail.
-- Kept as a single reusable function; disable the trigger explicitly for an
-- audited maintenance window (or TRUNCATE, which bypasses row triggers).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Disable trigger ' || TG_NAME || ' for an audited maintenance window.';
END;
$$;

CREATE TRIGGER api_key_usage_logs_append_only
  BEFORE UPDATE OR DELETE ON api_key_usage_logs
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();
