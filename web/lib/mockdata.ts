// Back-compat barrel. Mock fixtures now live with the feature that owns them
// under lib/features/*. Re-exported here so any older import keeps resolving.
export { MOCK_RESUME_REVIEW } from "./features/resume";
export { MOCK_VOICES, MOCK_FACES } from "./features/profile";
export { MOCK_QUESTIONS } from "./features/catalog";
export { MOCK_REPORT } from "./features/interview";
