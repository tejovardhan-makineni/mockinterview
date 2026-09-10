# App database role hardening

**Review artifact; not applied to production.** The observed `mockinterview`
login has `CREATEROLE`, `CREATEDB` and membership in `cloudsqlsuperuser` on a shared
Cloud SQL instance. Those privileges exceed this application's needs. Cloud SQL
grants them by default to a built-in user created without custom database roles;
specifying a precreated custom role avoids that default.
[Cloud SQL user management](https://docs.cloud.google.com/sql/docs/postgres/create-manage-users)

The observed app database is owned by `cloudsqlsuperuser`; its `public` schema
is owned by `pg_database_owner`. The 14 existing tables and 27 indexes belong to
`mockinterview`. The app's `cloudsqlsuperuser` membership has no admin option.
A rollback-only rehearsal confirmed that this existing login can grant access
to its own database/schema by temporarily assuming its existing membership,
reset its role, reduce its own attributes, and then revoke that membership. The
order matters: revoking membership before reducing attributes fails. This does
not justify adding administrative access to a login that does not already have it.
[PostgreSQL ALTER ROLE](https://www.postgresql.org/docs/16/sql-alterrole.html)

## Immediate approach: preserve the current object owner

The current API applies migrations at startup and needs to create/alter its own
tables. Restrict the existing app login in place: this preserves ownership,
credentials and compatibility with the old serving revision. Explicitly grant
access to its own database/schema before removing inherited administrative access.
Schema `CREATE` and object ownership support app DDL without cluster-wide role or
database creation privileges.
[PostgreSQL schema privileges](https://www.postgresql.org/docs/16/ddl-schemas.html)

Use the guarded [restrict-db-role.sql](../deploy/restrict-db-role.sql). It validates
that the connected database and existing login match the exact app name, that
only the app owns its public relations, that database/schema owners match the
reviewed app or Cloud SQL owner, and that no unexpected memberships or
cross-database ownership exist. It preserves direct grants before reducing
attributes and revoking membership, and checks the resulting privileges in the
same transaction. It uses neither `CASCADE` nor `REASSIGN OWNED`.

The default mode requires an authorized database operator. With credentials
provided through a protected connection mechanism, rehearse the exact script:

```bash
psql -X --set app_db=mockinterview --set app_role=mockinterview \
  --file deploy/restrict-db-role.sql
```

The separately reviewed self-demotion mode must connect directly as the exact
app login and requires its **existing direct** `cloudsqlsuperuser` membership:

```bash
psql -X --set app_db=mockinterview --set app_role=mockinterview \
  --set self_demote=on --file deploy/restrict-db-role.sql
```

Both commands roll back by default. After reviewing the rehearsal, add
`--set apply_changes=on` to commit. In self-demotion mode the script uses
`SET LOCAL ROLE cloudsqlsuperuser` only for the app database/schema grants, then
`RESET ROLE`, `ALTER ROLE … NOCREATEDB NOCREATEROLE`, and finally `REVOKE`.
It never adds membership or changes object ownership. It refuses self-demotion
when the existing membership is absent; use operator mode for an already
restricted login. An error aborts the transaction. Do not work around permission
failures by broadening grants. This is a manual release prerequisite, not an
application migration or an automatic Cloud Run startup action.

Before applying it, rehearse against an isolated restored database with equivalent
ownership/ACLs. Record role attributes and direct grants. After the rehearsal,
connect as the restricted app role and verify schema migration, create/alter/drop
of a disposable table, identity-sequence use, normal reads/writes and report
recovery. Confirm `CREATEROLE`/`CREATEDB` and elevated membership are absent. Then
run the reviewed operation during a controlled release window and verify both
the old and candidate revisions. It does not rotate a password or terminate
connections. If application checks fail, restore only the reviewed app-specific
grants needed; do not blanket regrant `cloudsqlsuperuser` or alter other apps.

## New installations

Precreate `mockinterview_owner` as a reviewed `NOLOGIN NOCREATEDB NOCREATEROLE`
role using the database operator, with no privileged memberships. Do not use
another application's runtime login to create it: PostgreSQL can grant the
creator membership in a role it creates. After the database exists, the operator
must grant the custom role `CONNECT, TEMPORARY` on that database and `USAGE,
CREATE` on its intended schema, before starting the API. The provisioning helper
does not issue PostgreSQL grants. For a restored database, also verify that the
new login owns the app relations or can assume their reviewed owner; schema
grants alone do not permit altering another role's tables.

Set `DB_OWNER_ROLE=mockinterview_owner` when creating the login. The setup helper
passes `databaseRoles: ["mockinterview_owner"]` to Cloud SQL and refuses a missing,
default-administrator or other-app role. A missing custom role must fail; the
helper never retries without `databaseRoles`. For staging use its own database
and `DB_OWNER_ROLE=mockinterview_staging_owner`. Existing logins are not silently
reassigned or demoted by the provisioning script. Verify their attributes
separately. Provider password updates remain explicit and do not reset role
memberships.

## Longer-term separation and limits

A later migration can separate a `NOLOGIN` object owner, an operator-only
migration login and a DML-only runtime login. That requires an explicit migration
job and startup version checks, because the current API still performs DDL at
startup. Transfer individually inventoried app objects, including sequences and
default privileges, only inside this app's database; never perform a broad
cluster ownership transfer during release.

PostgreSQL roles are cluster-wide. Removing elevated membership restricts this
login's privileges but does not create a deny rule against privileges granted to
`PUBLIC` elsewhere. Do not claim absolute database isolation from these changes.
Other applications' ACLs remain untouched; stronger cross-application isolation
requires their owners' review or a separate PostgreSQL instance.
[PostgreSQL databases and schemas](https://www.postgresql.org/docs/16/ddl-schemas.html)
