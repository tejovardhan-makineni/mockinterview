# Tester access

Approved testers can start hosted interviews without the daily start cooldown or
weekly platform-funded allowance. Their post-interview product check-in is
optional, and the shared 30-request/hour ancillary AI allowance does not apply
(for example, resume AI and provider connection checks). The setup page shows
**Tester access · unlimited interviews** after the
account's email is verified and the entitlement is loaded.

The registry stores normalized email addresses independently of user accounts,
so an operator can add a tester before registration. Leading/trailing whitespace
is removed and email addresses are lowercased. Access requires the account's
verified email to match the registry exactly after normalization. Adding an email
does not verify the account or grant an administrator role.

Testers still accept current adult, terms and privacy requirements, acknowledge
voice processing for voice interviews, and provide a valid provider key when
choosing personal-key practice. One active interview per account remains enforced;
resume or finish it before starting another. Provider availability and interview
duration settings still apply.

Authentication throttles and other security checks remain active. Tester starts
are recorded in the account's usage history and excluded from the standard
platform-funded budget used to limit ordinary hosted practice.

Removing an email ends its tester entitlement for subsequent requests and restores
the standard hosted allowance and required check-in rules. Removal does not delete
the account, existing interviews or saved responses. Recent tester starts count
toward that account's standard cooldowns after access is removed.

## Management API

All routes require `Authorization: Bearer <token>` from a signed-in, email-verified
account with the current stored `admin` role. A tester without this role cannot
manage the registry. Use the `token` returned by `POST /api/v1/auth/login` for the
administrator account. Keep credentials and tokens outside source control.

| Method and path | Request body | Success response |
|---|---|---|
| `GET /api/v1/admin/testers` | None | `200 {"testers":[{"email":"tester@example.com","created_at":"..."}]}` |
| `POST /api/v1/admin/testers` | `{"email":"tester@example.com"}` | `200 {"tester":{"email":"tester@example.com","created_at":"..."}}` |
| `DELETE /api/v1/admin/testers` | `{"email":"tester@example.com"}` | `204` with no response body |

For production, set `MI_API_ORIGIN` to the [stable API origin](https://mockinterview-api-a35kjmd22q-uw.a.run.app).
Set `MI_ADMIN_TOKEN` to the administrator's bearer token in your shell. The following
requests illustrate the API with a synthetic email address:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $MI_ADMIN_TOKEN" \
  "$MI_API_ORIGIN/api/v1/admin/testers"

curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $MI_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"email":"tester@example.com"}' \
  "$MI_API_ORIGIN/api/v1/admin/testers"

curl --fail-with-body --silent --show-error \
  -X DELETE \
  -H "Authorization: Bearer $MI_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"email":"tester@example.com"}' \
  "$MI_API_ORIGIN/api/v1/admin/testers"
```

Invalid email input returns `400`; unauthenticated requests return `401`; accounts
without the required verified administrator access return `403`. Repeating an add
or remove is safe: the registry contains at most one entry per normalized email.

## Operator CLI

An authorized operator can manage testers with the existing admin command and the
application's database configuration. This supports initial setup when no verified
administrator account exists. Use the app-scoped database/login; changes persist
across API restarts and deployments.

Run from the repository's `api` directory with `DATABASE_URL` and the usual
application environment configured:

```sh
go run ./cmd/admin -list-testers
go run ./cmd/admin -add-tester tester@example.com
go run ./cmd/admin -remove-tester tester@example.com
```

To verify account access, authenticate as the tester and read `GET /api/v1/usage`:
`tester_unlimited: true` indicates the hosted entitlement. This is separate from
`local_unlimited`, which remains a development-only installation setting. The
tester receives an empty list from `GET /api/v1/feedback/required`. Refresh the
setup page after changing membership to load the latest allowance.
