# Conversational interviews

The text and native voice interviewers use the same conversation policy. Each
turn should ask for one answerable thing, then wait. Scenario facts and technical
constraints stay available; requests for approach, implementation, results and
reflection are introduced when relevant instead of being read as a checklist.

For behavioral interviews, STAR is an internal evidence guide. The interviewer
starts with a specific situation and follows up on what is missing. If a
candidate volunteers their actions and outcome together, both count. Concrete
qualitative results are valid when a meaningful metric is unavailable.
Live prompts use separately authored, focused story openings; the original
assignments and scoring rubrics remain unchanged.

Follow-ups should seek new evidence. The interviewer should stop after one or
two unproductive attempts at the same gap, respect a request to move on, and
choose another useful topic or stage. Corrections replace stale assumptions;
clarification requests receive answers. Candidate-led formats can have a reply
without an assessment question.

The server supplies the actual session stage and remaining time before generating an opening or
resumed answer. Reconnects restore the saved conversation, including earlier
probes, and leave unanswered questions waiting for the candidate. Timing cues
do not reset completed topics. A silence nudge can happen once until the
candidate speaks or types again; the interviewer's own speech cannot rearm it.

The illustrated avatars have one mouth with anchored corners and upper lip.
Audio level opens the lower contour with short smoothing, and silence closes
it. Voice previews use the same level signal. Reduced-motion preferences keep
the portrait still.

## Verification

`make test` covers prompt contracts, transport lifecycle, avatar motion, preview
level resets and silence-nudge behavior. Live-package tests also exercise text
reconnection with the original resume/round-focus plan and voice stage ordering.

The opt-in provider evaluation in
`api/internal/live/director_provider_test.go` makes billable calls to the actual
text and native-audio models using synthetic histories from
`api/data/fixtures/conversation-pacing.json`. It does not record a microphone,
camera, or real candidate transcript. Set `RUN_DIRECTOR_PROVIDER_EVAL=1`,
`GEMINI_API_KEY`, and an absolute private `DIRECTOR_EVAL_OUTPUT` path, then run:

```sh
cd api
go test ./internal/live -run TestDirectorProviderEvaluation -count=1 -timeout=12m -v
```

Review every saved response against its `review` criterion. Successful provider
generation is not a quality verdict. Counting question marks does not detect
several requests in one sentence, repeated meaning, or a missed correction.
The fixtures cover bundled behavioral openings, a complete STAR answer,
exhausted probes, moving on, corrected code, multiple design components, a case
clarification, and candidate-led questions in both delivery modes.

Pacing is guided by model instructions and conversation context. Native audio
streams before its final transcription is available, so these checks are
sampled behavioral evidence, not a deterministic guarantee about every turn.
