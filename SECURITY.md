# Security policy

Report vulnerabilities privately through this repository's
[GitHub private vulnerability reporting](https://github.com/tejovardhan-makineni/mockinterview/security/advisories/new)
(Security → Report a vulnerability). Include affected version, reproduction
steps, impact and a minimal redacted example. Do not open a public issue with
credentials, account data or an exploitable vulnerability. If reporting is
unavailable, ask the maintainer to enable a private reporting channel without
posting vulnerability details.

Only the latest `main` receives security fixes during the preview period. A
maintainer will assess reports and coordinate a fix and disclosure; there is no
guaranteed response time. Avoid tests that access other people's accounts or
cause disruption. Use your own local instance for invasive testing.

Keep provider keys and database credentials in local `.env` files or the deployed
secret manager. Never commit them, include them in transcripts, or attach them
to issues. Rotate any exposed credential immediately. Development defaults and
`LOCAL_UNLIMITED=true` are for local use and must not be exposed publicly.

Security review should cover account verification and recovery, authorization,
quota concurrency, session ownership, credential redaction and expiry, export
and deletion, provider failures and private reference leakage. A passing unit
suite does not replace deployment configuration or live security verification.
