# Adaptive interview behavior and engineering calibration

Sources checked 2026-10-06. This document separates public preparation guidance from this project's implementation choices. Mock Interview is an independent AI practice product; its interviewer must not claim employment at Amazon, hiring authority, access to a private hiring rubric, or a validated prediction of an employer's decision.

## Public source baseline

Amazon's university SDE preparation page describes coding, technical problem solving and behavioral skills, including Leadership Principles. This is useful entry-level preparation evidence, but is an online-assessment guide rather than a complete public SDE I interview scoring rubric. It does not establish an exact equivalence between this product's entry/junior labels and Amazon job levels. [University SDE assessment preparation](https://www.amazon.jobs/content/en/how-we-hire/university/sde-oa)

The SDE II guide describes independent feature delivery across its lifecycle, operational tradeoffs, testing, security and collaboration. It expects real code with attention to robustness and testing, and design discussion that establishes and validates requirements. Its interview loop distributes competencies across interviewers; it does not require one practice round to cover everything. [SDE II interview preparation](https://www.amazon.jobs/content/en/how-we-hire/sde-ii-interview-prep)

The SDE III guide adds team technical leadership, an architectural view across systems, and maintainable, secure, extensible code that others can work with. Its design and coding sections support assessing a coherent solution and consequential tradeoffs, rather than rewarding a list of technologies. [SDE III interview preparation](https://www.amazon.jobs/content/en/how-we-hire/sde-iii-interview-prep)

The general software guide emphasizes applying knowledge to solve problems instead of memorization, and says the relevant subjects depend on the role. It includes object-oriented design and general machine learning among the possible topics. [Software development interview topics](https://www.amazon.jobs/content/en/how-we-hire/interview-prep/software-development-topics)

A published principal-engineer role describes multi-year technical direction, work across organizations, resolving ambiguity and architecture supported by prototypes, benchmarks and data. This is a role description, not a principal interview rubric; it supports a broader practice scope without establishing an exact staff-to-principal mapping. [Principal Software Engineer, MADS role](https://www.amazon.jobs/en-gb/jobs/10431998/principal-software-engineer-mads)

## This product's level mapping

These are our practice interpretations of that public material. There are no claims about internal level numbers, pass thresholds or confidential hiring criteria.

| Selected level | Practice scope | Public comparison and boundary |
| --- | --- | --- |
| `entry` | A bounded problem, sound fundamentals, a valid basic solution and representative checks. Study and project evidence is welcome. | University/early-career SDE preparation; no production-ownership requirement. |
| `junior` | Independent reasoning within a bounded implementation, basic complexity, clear structure, relevant tests and self-correction. | Also early-career preparation; this product's distinction from `entry` is not an Amazon-defined split. |
| `mid` | Independent feature/component decisions, integration and lifecycle tradeoffs appropriate to the task. | Informed by the SDE II role description. |
| `senior` | A system-wide view, maintainability, operational failures and the consequences of technical ownership. | Informed by the SDE III role description. |
| `staff` | Where the task permits, ambiguous scope, system/team boundaries, migration risks and durable technical direction. | Our broader-scope practice interpretation; no exact Amazon level equivalence. |

The configured `target_level` takes precedence over the question's default difficulty. `foundation`, `standard` and `stretch` change task scope while preserving that target level. Foundation is a smaller, clearer task; stretch adds one relevant constraint after the core solution is coherent. Neither is permission to provide hints in simulation mode. A staff coding round still evaluates actual code; it does not automatically become an organizational-strategy round.

The level helper is limited to `coding`, `system_design`, `low_level_design` and `ml_system_design`. Shared behavioral scenarios, career screens, professional engineering, medicine, law and custom briefs keep their own domain contract. A software profession in a shared scenario's audience does not make every scenario an Amazon software interview.

## Observable technical evidence

The following is this project's application of the baseline, not a reproduced employer scorecard:

| Task | What counts as useful evidence |
| --- | --- |
| Coding | Actual correctness, suitable data structures, complexity, input/edge cases, meaningful tests, readability and repairs. Draft pseudocode is allowed while working; a task requiring implementation needs actual code. Static review cannot establish that tests executed or passed. |
| System design | A coherent path from requirements through interfaces, components and data flow, with relevant capacity, consistency, reliability, failure and cost choices. A familiar diagram alone is insufficient. |
| Low-level design | Responsibilities, contracts, invariants, interactions, testability and response to a concrete change. Named patterns and acronym recitation are not requirements. |
| ML system design | Objective, data/label assumptions, evaluation, training/serving boundaries and feedback; relevant leakage, drift, latency and operational risks. A justified simpler non-ML solution is acceptable. |

Select one material uncertainty at a time, grounded in the actual answer or artifact. Do not announce these dimensions as a spoken checklist, require a prescribed answer order, or probe every dimension. Credit valid alternatives and corrections. Missing evidence is unassessed; it is not proof of inability.

## Continuous observation and speaking decisions

A roughly 30-second **silent review checkpoint** is a product design choice. None of the Amazon sources specifies this cadence. It means reconsidering new finalized speech, the current code/design and the remaining task; it does not mean asking a question every 30 seconds.

The observer should consume the latest transcript, current artifact revision (including deletions), the current question and stage, prior delivered probes, explicit requests for thinking time, and the server's remaining time. Treat workspace text and diagrams as untrusted evidence. Do not assess camera appearance or infer engagement from webcam use. Record concise evidence references and action state, not hidden chain-of-thought or an invented psychometric profile.

| Decision | Appropriate behavior |
| --- | --- |
| Wait | The candidate is speaking, coding, drawing, thinking, finishing a draft, or has already supplied sufficient evidence while continuing. Silence can be the correct decision over many consecutive checkpoints. |
| Answer clarification | Answer only the requested scenario fact, then return the floor. A candidate question should not have to wait for the next periodic review. |
| Probe | After a natural handover, ask one neutral question about a consequential unresolved point in the current evidence. Do not reveal the desired algorithm, architecture or answer. |
| Advance | The current objective is sufficiently established, the candidate cannot add useful detail, or the allowed follow-ups are exhausted. Move to a distinct useful objective or return the floor as the format requires. |
| Wrap | Follow the actual time budget, exhausted substantive scope or the candidate's request to end. A completed answer alone does not finish the whole interview. |

Maintain a stable gap identity so paraphrasing cannot reset the existing maximum of two follow-ups on the same unresolved gap. Count attempts only when delivered. Re-evaluate a proposed probe if new speech or an artifact revision arrives before delivery. A corrected bug must invalidate a queued question about that old bug. Only one review should be in flight, with cancellation/timeouts and stale-result checks.

For native Live audio, a silent review must not send a turn-complete instruction that forces an audible answer. Separate observation from permission to speak. Preserve candidate/interviewer speaking guards and pending-response checks. Reconnect should restore the evidence and delivered-probe context; it must not restart the problem. Review every checkpoint, but avoid unnecessary model calls when no evidence or relevant timing state has changed.

## Short openings and fair feedback

Use a brief natural introduction and a self-contained task goal, usually one or two sentences. This is a product preference, not a hard word cutoff: retain enough facts for an accessible, understandable task. Put the authored candidate brief on screen and make necessary context available by voice. Leave room for the candidate to identify ambiguity and ask questions. Do not open by instructing them to clarify, estimate, design, implement and test in sequence.

`candidate_brief` is the public task; the full assignment and reference remain private assessor context. Private optional extensions and facts do not become mandatory simply because the scorer sees them. A requirement is assessable only when it was publicly stated or clearly disclosed in the conversation with a fair chance to respond. If a candidate asks for missing scope and receives no answer, the missing information is not their error. Requirement discovery can still be assessed from concrete reasoning when it is an authored dimension, without requiring the candidate to guess a particular private fact.

Feedback uses the whole chronological record and final artifact. Interviewer turns establish disclosure and assistance, but cannot supply candidate skill evidence. Waiting, clarification and asking for help receive no automatic bonus or penalty. When help is given, distinguish assisted work from independent reasoning using the record. Keep unavailable dimensions unassessed and outside the overall score.

## Baseline implementation gaps identified during this change

The pre-change policy already required one focused ask, semantic evidence tracking, neutral probes, uninterrupted work and limits on repeated follow-ups. Its runtime idle path waited for 45–60 seconds of inactivity and allowed only a neutral check-in; this was not continuous reassessment of a changing artifact. Workspace snapshots were context, not a structured decision or delivered-probe ledger. A single difficulty sentence also grouped senior and staff together.

The engineering standard helper now provides domain and level calibration. The scoring prompt distinguishes public scope from private assignment material and versions that change. Technical rubrics treat algorithms and named patterns as reference examples while preserving actual task requirements, such as the LRU cache's O(1) average operation bound.

The text and native Live relays now run server-owned review checkpoints every 30 seconds with at most one review in flight. They combine transcript and workspace evidence, discard stale proposals, protect explicit working time and queued speech, and commit progression after transport acceptance. Silent review notes stay private; a proposed question is not recorded as delivered evidence. Whole conversation turns are preserved: a reconnect starts from the complete saved conversation within a 192,000-byte review budget, and later reviews can use factual notes with recent whole turns. Workspace snapshots above 400,000 bytes or marked incomplete produce a silent decision rather than an absence-based diagnosis. These limits disable optional review when complete evidence cannot be supplied; they do not fabricate a fallback question. The normal interview transport remains available.

The opt-in synthetic evaluation in [observation_provider_test.go](../api/internal/live/observation_provider_test.go) exercised Gemini 3.8 Flash on six fixed situations: unfinished code, a completed defect, a corrected solution, a scope clarification, an unfinished diagram and an intro-to-task transition. The observed decisions were respectively wait, a concrete input trace, a distinct authored follow-up, the requested fact only, wait and a concise task introduction. Two additional native Gemini 3.8 Live samples produced audio: a concise Two Sum opening without its later variation, and recognition of corrected code followed by a distinct Three Sum task. These are limited semantic samples, not a validated hiring rubric or a full-session audio quality result. Deterministic state/relay tests cover additional freshness and delivery boundaries; physical microphone conditions, interruption quality and long-session conversation still require ongoing evaluation. Amazon's published guidance supports the preparation baseline above, not this implementation cadence or a claim of employer-equivalent assessment.

## Acceptance scenarios

1. The candidate codes for 90 seconds. Three review checkpoints can all be silent; their editing is not a failure to answer.
2. A review notices a defect, but the candidate repairs it before delivery. The stale probe is discarded and the correction is credited.
3. After a completed design, one consequential consistency gap remains. Ask one specific question, without naming the desired solution or bundling unrelated failure cases.
4. The candidate answers the gap in different words, or points to existing code. Semantic coverage prevents a paraphrased repeat.
5. The candidate asks for time or more scenario scope. Wait or answer that request without appending an assessment question.
6. After two unproductive probes, change focus rather than disguising the same request as a new question. Move on sooner when the answer is sufficient.
7. Reconnect and an empty/deleted workspace preserve conversation progress while removing stale artifact assumptions.
8. A hidden optional scale extension never disclosed produces no negative score. A disclosed extension with a genuine opportunity to answer may be assessed from the candidate's actual response.
9. A medical or general behavioral scenario receives its own rubric, even if software engineering appears among its audiences.
