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
