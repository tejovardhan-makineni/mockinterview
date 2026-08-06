# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), or email the maintainer.

We aim to acknowledge reports within 72 hours and to ship a fix or mitigation as
quickly as the severity warrants. Please give us a reasonable window to address
the issue before any public disclosure.

## Scope & handling of secrets

- API keys and database credentials live only in `.env` / `deploy/*.env`, which
  are gitignored. Never commit secrets. If a secret is committed, rotate it
  immediately and open a private report.
- Auth is email/password with bcrypt hashing and short-lived JWTs. The live
  interview WebSocket authenticates via a query-string token because browsers
  can't set headers on `WebSocket`; treat that token as a bearer credential.
- User data (transcripts, resumes, behavioral samples, scores) is deleted via
  `ON DELETE CASCADE` when an account is deleted.

## Supported versions

This project is pre-1.0; only the latest `main` receives security fixes.
