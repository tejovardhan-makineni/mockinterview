<!-- Thanks for contributing! Keep PRs focused on one feature/module. -->

## What & why

<!-- What does this change and why? Link the related issue: Closes #___ -->

## Scope check

- [ ] The change is scoped to one feature/module per layer (or I explain why not).
- [ ] Frontend data access goes through the `api` seam (no direct `fetch()`), and
      both the `http` and `mock` slice impls are updated if I touched the API.
- [ ] If I added a store method, I updated the feature's `Repo` interface,
      `store.Datastore`, and `memstore`.
- [ ] Catalog changes (voice/face/personality/question) are data rows, not
      literals threaded through code.

## Tests

- [ ] `cd api && go build ./... && go vet ./... && go test ./...` passes.
- [ ] `cd web && npm run lint && npm test && npm run build` passes.
- [ ] I added/updated tests for the behavior I changed.

## Notes

<!-- Screenshots, tradeoffs, follow-ups, anything reviewers should know. -->

## Interview content (if changed)

- [ ] Original/licensed material; authorship, sources and AI assistance disclosed.
- [ ] Revision updated; new formats/scenarios start as preview.
- [ ] Conditional facts and probe triggers are consistent and included in fixtures.
- [ ] Alternatives, partial answers, late corrections, silence and wrap-up considered.
- [ ] Rubric dimensions are observable, fair and distinguish not-assessed evidence.
- [ ] Reviewer and calibration claims reflect work actually completed.
- [ ] `make validate-content` passes; private answers stay out of candidate summaries.
- [ ] No real candidate records, confidential questions or credentials included.
