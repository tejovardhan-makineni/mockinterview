-- MANUAL OPERATOR STEP. Not an application migration or automatic deploy hook.
-- Review docs/DATABASE-ROLE-HARDENING.md, rehearse on an isolated restored DB,
-- and connect as a sufficiently privileged database operator. The separately
-- reviewed app self-demotion path requires --set self_demote=on; see the runbook.
-- psql -X --set ON_ERROR_STOP=1 --set app_db=mockinterview \
--   --set app_role=mockinterview --file deploy/restrict-db-role.sql
-- Default: rehearse and ROLLBACK. Add --set apply_changes=on to commit.
-- Supply connection credentials through a protected connection mechanism.
\set ON_ERROR_STOP on
\if :{?self_demote}
\else
\set self_demote off
\endif
\if :{?apply_changes}
\else
\set apply_changes off
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
SELECT set_config('mockinterview.target_database', :'app_db', true);
SELECT set_config('mockinterview.target_role', :'app_role', true);
SELECT set_config('mockinterview.self_demote', :'self_demote', true);

DO $guard$
DECLARE
  db text := current_setting('mockinterview.target_database');
  target text := current_setting('mockinterview.target_role');
  target_id oid;
  database_id oid;
  self_demote boolean := current_setting('mockinterview.self_demote')::boolean;
  elevated_id oid;
BEGIN
  IF db !~ '^mockinterview([_-][a-z0-9]+)*$'
     OR target <> db OR current_database() <> db THEN
    RAISE EXCEPTION 'Refusing target: app database and existing app role must match exactly';
  END IF;
  IF self_demote THEN
    IF session_user <> target OR current_user <> target THEN
      RAISE EXCEPTION 'Self-demotion requires a direct connection as the exact app login';
    END IF;
  ELSIF session_user = target OR current_user = target THEN
    RAISE EXCEPTION 'Use an authorized operator, or explicitly select the reviewed self-demotion mode';
  END IF;
  SELECT oid INTO target_id FROM pg_roles
    WHERE rolname = target AND rolcanlogin AND NOT rolsuper
      AND NOT rolreplication AND NOT rolbypassrls;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'Expected an existing ordinary app login without superuser/replication/RLS-bypass attributes';
  END IF;
  SELECT oid INTO database_id FROM pg_database WHERE datname = db;
  SELECT oid INTO elevated_id FROM pg_roles WHERE rolname = 'cloudsqlsuperuser';
  IF NOT EXISTS (
    SELECT 1 FROM pg_database WHERE oid = database_id
      AND (datdba = target_id OR datdba = elevated_id)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_namespace n JOIN pg_roles owner ON owner.oid = n.nspowner
    WHERE n.nspname = 'public'
      AND (n.nspowner = target_id OR n.nspowner = elevated_id OR owner.rolname = 'pg_database_owner')
  ) THEN
    RAISE EXCEPTION 'Unexpected app database or public schema owner; review scope';
  END IF;
  IF self_demote AND NOT EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = target_id AND roleid = elevated_id
  ) THEN
    RAISE EXCEPTION 'Self-demotion requires the existing direct cloudsqlsuperuser membership; never add it for this script';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid = m.roleid
    WHERE m.member = target_id AND parent.rolname <> 'cloudsqlsuperuser'
  ) THEN
    RAISE EXCEPTION 'Unexpected app role membership; review before reducing privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass AND refobjid = target_id
      AND deptype = 'o' AND dbid NOT IN (0, database_id)
  ) OR EXISTS (
    SELECT 1 FROM pg_database WHERE datdba = target_id AND datname <> db
  ) THEN
    RAISE EXCEPTION 'App role owns objects outside the selected database; review scope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m','f')
      AND c.relowner <> target_id
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'schema_migrations' AND c.relowner = target_id
  ) THEN
    RAISE EXCEPTION 'Public app relations are not exclusively owned by the expected app login';
  END IF;

  -- Direct grants preserve startup migrations after inherited access is removed.
  -- Object ownership already supplies ALTER/DROP privileges for app-owned tables.
  -- In self-demotion mode this only assumes a membership the login already has.
  -- It never grants a role or changes ownership. RESET ROLE before reducing the
  -- login's own attributes; revoking its membership first prevents that step.
  IF self_demote THEN
    EXECUTE 'SET LOCAL ROLE cloudsqlsuperuser';
  END IF;
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', db, target);
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', target);
  IF self_demote THEN
    EXECUTE 'RESET ROLE';
  END IF;
  EXECUTE format('ALTER ROLE %I NOCREATEDB NOCREATEROLE', target);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') THEN
    EXECUTE format('REVOKE cloudsqlsuperuser FROM %I RESTRICT', target);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = target_id
             AND (rolcreatedb OR rolcreaterole OR rolsuper OR rolreplication OR rolbypassrls))
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = target_id)
     OR NOT has_database_privilege(target, db, 'CONNECT')
     OR NOT has_database_privilege(target, db, 'TEMPORARY')
     OR NOT has_schema_privilege(target, 'public', 'USAGE')
     OR NOT has_schema_privilege(target, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Restricted-role postconditions failed; rolling back';
  END IF;
END
$guard$;
\if :apply_changes
COMMIT;
\else
ROLLBACK;
\echo 'Rehearsal passed; changes rolled back. Use apply_changes=on only after review.'
\endif
