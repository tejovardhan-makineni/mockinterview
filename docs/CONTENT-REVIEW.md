# Scenario review and scoring calibration

Content additions remain `preview`. Automated schema checks, another AI's review
and successful provider calls do not constitute practitioner review or scoring
calibration. This process provides review materials; it does not fabricate a
reviewer, credential, rating, agreement result or readiness threshold.

## Prepare a private review

Run `make content-audit` to identify thin role/level coverage. Select a concrete
scenario and export its unfilled worksheet:

```sh
python3 scripts/content_coverage.py --review-packet new-manager-feedback > /tmp/new-manager-feedback-review.json
```

The worksheet contains the reference facts, rubric and private probes. Do not
publish it through the candidate UI or show it to a candidate before assessment.
Use synthetic responses without employee, patient or customer records. The
`api/data/fixtures/*-context.json` files provide example turns for clarification,
partial reasoning, alternatives, correction, silence and wrap-up. They are
authored examples, not observed model behavior or independently rated samples.

## Practitioner content review

An actual practitioner with relevant experience records their name, review date,
scope and limitations in the worksheet. Domain-sensitive content requires a
qualified reviewer for that domain; general software review is insufficient.

Review task realism, supplied facts and arithmetic, role/level fit, time budget,
accessibility, alternative valid decisions and observable rubric anchors. Check
that a candidate can ask for missing information, and that unknown or unrevealed
facts do not become hidden requirements for a high score. Examine authority and
scope boundaries. The new pharmacy, dental, allied-health, veterinary and aviation
exercises practice communication, verification and service judgment; they do not
assess clinical procedures, piloting or licensing competence.

Record specific findings and any required edits. After corrections, increment
the scenario revision and obtain a review of the revised material. A real
accepted content review may set `review_status: reviewed` with `reviewer` and
`reviewed_at` provenance. Describe the review's scope in `authorship` or the linked
review record. This status says nothing about model agreement or hiring validity.

## Separate scoring calibration

Before making a reliability claim, collect varied synthetic responses under a
documented provider, model, prompt/corpus revision, role, target level and practice
mode. Include sufficient, partial and incorrect reasoning; valid alternative
solutions; late corrections; requests for missing facts; and insufficient evidence.
Test entry/junior and advanced IC work separately from management and executive
work. Include written workspace evidence where the format uses it.

At least two independent qualified reviewers rate each observable rubric dimension
before seeing the model score or each other's ratings. Keep the cited evidence,
assistance supplied and `not assessed` decisions alongside the ratings. Compare
human/model and human/human disagreement by dimension and scenario; investigate
systematic errors instead of reporting only an aggregate average. Select the
sample size, agreement method and acceptance thresholds before examining results,
with appropriate evaluation expertise. This repository does not supply a validated
threshold or pretend that a small smoke test establishes one.

Revise on a development set, then evaluate a held-out set without tuning against
its answers. Preserve disagreements, failures, uncertainty and the scope of the
conclusion. A well-rated practice session does not certify job readiness or
authorize real clinical, legal, financial or operational decisions.

## Release evidence

Record source revision, content revisions, automated test results, real-provider
checks actually performed, human reviews actually received, and work still pending.
Keep implementation validation distinct from deployment verification. Catalog and
readiness GET checks establish serving content and configuration, not conversation
quality. After deploying, verify management pack defaults, a new profession path,
saved-session recovery and a completed report with synthetic data before claiming
those live flows were checked. Follow the existing release gates and rollback
procedure; never weaken them to publish additional content.
