# Mobile validation — September 18–19, 2026

The first mobile companion is implemented in Expo / React Native. It provides
local interview prep and guided self-review; it has no account sync, transcription,
or AI assessment. The website remains the entry point for live AI interviews.

## Automated checks

- TypeScript: `npm run typecheck` — passed on final source.
- Domain and persistence: `npm test` — 10 tests passed. Coverage includes prompt
  rotation, session validation, exact resume position, concurrent writes, corrupted
  storage isolation/recovery, failed reads/writes, history limits, and deletion.
- Expo configuration: Expo Doctor — 21/21 checks passed; compatible dependency
  versions verified with `expo install --check`.
- Export: `npx expo export --platform all --output-dir dist --max-workers 1` —
  passed for web, iOS, and Android. Final web bundle was checked for explicit
  checkbox and tab accessibility states.

## Browser acceptance

Chrome at 390×844 and 320×568. The following flows were exercised against the
running application:

- Empty answers cannot advance; typed answers can be reviewed.
- Hints expand and collapse; bookmarks show a saved state.
- A three-question practice resumes the same question and its draft after reload.
- Self-review checkboxes expose their checked state to accessibility tools.
- A completed practice keeps all answers and its optional reflection; the finished
  draft does not return after reload.
- The daily one-question warm-up uses its selected prompt rather than the first
  prompt in the topic.
- Saved questions start the correct one-question practice.
- Deletion can be canceled; confirmed deletion removes the session and retains
  its question bookmarks. An unfinished draft can also be discarded.
- Narrow layouts, wrapping action labels, bottom navigation, and the scrollable
  information sheet remain usable. Tab changes reset the page scroll position.
- No browser console errors were reported during acceptance. Synthetic test data
  was cleared afterward. The final static production web export also passed a
  one-question answer, self-review, and save smoke test.

Screenshots: [Today](../output/playwright/mobile-today.png),
[Practice](../output/playwright/mobile-practice.png),
[Conversation](../output/playwright/mobile-conversation.png),
[Review](../output/playwright/mobile-review.png),
[Saved](../output/playwright/mobile-saved.png),
[small phone](../output/playwright/mobile-small.png).
The conversation, review, and saved screenshots contain synthetic test answers.

## Native checks

- iOS: local simulator build succeeded with zero errors. Installed and launched on
  iPhone 17e / iOS 26.5; home layout, safe areas, and bottom tabs were visually
  inspected. [Native screenshot](../output/playwright/mobile-ios.png).
- Android: local arm64 debug APK build passed. The local validation build used
  the already installed NDK 28.2 and CMake 3.22.1 through ignored Gradle properties,
  with two build workers. Installed and launched on Pixel 10 Pro / Android 37.
  Home layout and answer-field visibility above the keyboard passed. A one-question
  typed practice with one self-review checkpoint was saved, force-stopped, and
  reopened with the exact answer and checkpoint intact. Synthetic test data was
  cleared and the emulator/Metro stopped after verification.
  [Home](../output/playwright/mobile-android.png) ·
  [Keyboard](../output/playwright/mobile-android-keyboard.png) ·
  [Reopened answer](../output/playwright/mobile-android-reopened.png).

Native debug builds require a running Metro development server. The iOS simulator
build is preserved in `output/mobile-ios-simulator/MockInterview.app`; it is not
an iPhone distribution build. Generated iOS dependency and compiler intermediates
were removed after preserving the app to reclaim local disk space. The Android
arm64 debug APK and its Metro launch instructions are preserved in
`output/mobile-android-debug/`. Both artifact paths are relative to the repository
root; neither is a store distribution build.

## Release limits

Actual microphone capture and playback on physical iOS/Android phones still need
a release smoke test, including permission denial, background interruption, and
reopening saved recordings. This validation did not record room audio through the
host computer's microphone. Web preview intentionally supports typed answers only.

App Store / Play Store distribution, signing, and store listings are not configured
or submitted. Native production builds bundle their assets for offline practice;
development builds and Expo Go require Metro. See [README](README.md) for launch
and distribution instructions.
