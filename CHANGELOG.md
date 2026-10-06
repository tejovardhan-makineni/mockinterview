# Changelog

Source changes are recorded separately from verified deployments. Dates on older
release records describe the deployments verified by those records, not a claim
that the current source has been deployed.

## 2026-10-06 — Adaptive interview observation (source)

- Review the live workspace and conversation privately every 30 seconds in text
  and native voice interviews. The model chooses silence, a clarification,
  one grounded probe, or forward progress; the timer does not prescribe questions.
- Reassess corrected work, discard stale pending questions, respect speaking and
  working time, and use neutral input traces or concrete design scenarios instead
  of revealing a suspected mistake or its fix.
- Add concise public opening briefs to all 73 coding, system design, low-level
  design and ML design scenarios. Preserve full assignments privately and answer
  requirements questions without reading every extension at the start.
- Observe code language and diagram geometry/topology, including unlabeled
  shapes, unbound arrows and deletions. Refresh pending workspace context before
  speech starts. This observes the in-app workspace, not other apps or a camera.
- Calibrate technical practice by selected level using Amazon's public preparation
  guidance, without claiming access to a private hiring rubric. Grade correct
  alternatives fairly and do not penalize undisclosed optional constraints.

See [behavior and sources](docs/ADAPTIVE-INTERVIEWER.md). The director and scoring
versions are `2026-10-06.1`. Synthetic model evaluations and automated transport
tests support this change; they do not guarantee every generated interaction.
This source entry does not represent a deployment or installer release.

## 2026-10-05 — Beta clarity, device readiness and funded limits (source)

- Upgrade defaults to Gemini 3.8 Flash, Live and Flash TTS using the documented
  model IDs and current speech-preview API format.
- Enforce one lifetime funded interview for standard accounts and at most 200
  funded starts per UTC calendar day across the project, including testers.
  Personal-key/local interviews retain their separate rules. Reservations and
  activation check capacity atomically; reconnects reuse the existing attempt.
- Retain a minimal keyed-email claim after history/account deletion and detailed
  usage cleanup. Migrations backfill retained usage and surviving sessions;
  already deleted older usage cannot be reconstructed. Terms/privacy version
  is now `2026-10-05.1` and explains this retention.
- Show Beta in shared web/desktop navigation and the interview room. Tighten
  mobile navigation, secondary controls and catalog guidance.
- Replace oversized device checks with compact status rows. Show microphone
  test and camera-preview verification, optional speaker confirmation, and the
  exact reasons Start is disabled. Prefer natural installed voices for speaker
  tests and soft notes when only robotic system voices are available.
- Restore live microphone, connection and audio health with actionable recovery.
  Sound initializes automatically; playback recovery appears only when needed.
  Conversational interviews prioritize transcript and answers beside brief/notes.
- Collapse report check-ins and optional tool comparisons; keep required status,
  accessible choices, drafts and privacy choices visible and recoverable.

Validation includes the full API suite with PostgreSQL, quota races and SQLite
migration/retention checks, web and desktop unit tests, lint/type checks, and
browser checks at desktop/mobile sizes with synthetic mic/camera devices.
No hosted deployment or native installer release is claimed by this source entry.

## 2026-10-04 — Open source practice and community

### Project and community

- Introduce an open source project homepage, documentation, get-started guide,
  maintainer page, contribution paths and public release notes.
- Publish GitHub, Reddit and Discord community links. Invite real community
  stories; do not publish invented testimonials or private feedback.
- Change project code and original project scenarios to the MIT license; preserve
  third-party licenses, attribution and historical release records.
- Add a single cross-platform Docker-free local launcher. Default storage is
  explicitly temporary; persistent PostgreSQL and Docker are documented options.

### Practice and feedback

- Set standard funded access to one interview every rolling 24 hours, with Gemini
  2.5 Flash as the configured text/feedback default. Provider availability applies.
- Permit unlimited personal-key starts after provider/model validation, subject
  to provider charges and limits and one active attempt at a time.
- Add free-text custom profession, goal, level, questions and interview structure.
- Add beta applications with a feedback commitment and administrator approval.
- Add private template requests and owner administration.
- Add explicit optional analytics sharing for local web practice when an
  authenticated remote API is configured. Failed optional uploads do not block
  practice. This is not automatic backup or cross-device history sync.

The web app and API are released together after staged validation. Local setup
uses the source launcher; signed desktop installers are not included.

## 2026-09-14 — Interview bank expansion

185 scenarios, seven career families and 23 practice paths, with specialist
interviewer context. [Verified release record](docs/INTERVIEW-BANK-RELEASE-2026-09-14.md).

## 2026-09-13 — Microphone readiness and testers

Device readiness improvements and tester entitlements.
[Verified release record](docs/MICROPHONE-TESTERS-RELEASE-2026-09-13.md).

## 2026-09-10 — Privacy and policy controls

Adult access acknowledgment, policy versions, voice processing notice and data
controls. [Verified release record](docs/RELEASE-VALIDATION-2026-09-10.md).
