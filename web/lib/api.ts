// The API seam — a thin composer over the per-feature slices in lib/features/*.
// Each feature owns its own types, HTTP calls, and mock in ONE file; this file
// only assembles them into a single `api` object. To change a feature's data
// layer, edit lib/features/<feature>.ts — you never touch this file.
//
//   auth      → features/auth.ts       (+ api/internal/auth,    store/users.go)
//   profile   → features/profile.ts    (+ api/internal/profile, store/users.go+config.go)
//   resume    → features/resume.ts     (+ api/internal/resume,  store/resumes.go)
//   catalog   → features/catalog.ts    (+ api/internal/corpus,  data/corpus/*.json)
//   interview → features/interview.ts  (+ api/internal/interview+scoring+live,
//                                          store/sessions.go+reports.go+behavior.go)

import { authHttp, authMock, type AuthSlice } from "./features/auth";
import { profileHttp, profileMock, type ProfileSlice } from "./features/profile";
import { resumeHttp, resumeMock, type ResumeSlice } from "./features/resume";
import { catalogHttp, catalogMock, type CatalogSlice } from "./features/catalog";
import { interviewHttp, interviewMock, type InterviewSlice } from "./features/interview";

export { getToken } from "./http";

// The full client is the intersection of every feature slice.
export type Api = AuthSlice & ProfileSlice & ResumeSlice & CatalogSlice & InterviewSlice;

const useMock = process.env.NEXT_PUBLIC_MOCK === "1";

export const api: Api = useMock
  ? { ...authMock, ...profileMock, ...resumeMock, ...catalogMock, ...interviewMock }
  : { ...authHttp, ...profileHttp, ...resumeHttp, ...catalogHttp, ...interviewHttp };

export const IS_MOCK = useMock;
