# MockInterview mobile

A small, native iOS and Android companion for interview practice. It uses the website’s soft sage background, forest green accents, and lowercase **m** mark. Three tabs keep the main actions close: **Today**, **Practice**, and **Saved**.

## What is included

- Short practice sessions with one question at a time, across Behavioral, Career, and Technical topics.
- A messaging-style interview flow, optional hints, typed answers, and voice recording/playback on native devices.
- Guided self-review with question-specific checkpoints, bookmarks, and saved sessions.
- Local persistence for answers, draft position, bookmarks, the latest 30 completed practices, and native recordings of up to 90 seconds each. Core practice does not require the MockInterview server or an account.

This is a deliberately focused companion. Core practice works locally without a MockInterview account or AI service. Review prompts are guided self-assessment; there is no automated score, transcription, or AI-generated feedback. Optional hosted sign-in in About supports private product feedback and consented analytics when a server is configured. It does not synchronize website interview history. Typed answers and recordings are not uploaded; local app data may be removed when the app is uninstalled or its storage is cleared.

## Optional private feedback and analytics

Set `EXPO_PUBLIC_ANALYTICS_API_BASE` to the intended HTTPS API origin when starting
or building the app. No central server is configured by default. In **About**, sign
in with a verified account on that server. A product-feedback message is sent only
when you submit it. Separately enable **Share analytics** to share new completed
practice metrics, reflection and self-review checkpoints with the administrator.
Raw typed answers, recordings and credentials are excluded from analytics.

The sharing token and opt-in stay in memory; closing/restarting the app requires
sign-in and consent again. Sessions begun before consent are not backfilled.
Optional analytics upload failures are caught and do not interrupt practice; there
is no offline upload queue or backup guarantee. Feedback submission failures stay
visible so you can retain and retry the note. **Delete shared analytics** deletes
this account's shared uploads at the connected server; local practice deletion is
a separate control. Only the configured server's authorized owner can review the
shared product records.

## Run locally

Use Node.js **22.13 or newer** and npm. The project is pinned to Expo SDK 57, React Native 0.86.3, and React 19.2.3. SDK 57 supports **iOS 16.4+** and **Android 7+**; native iOS compilation needs macOS with Xcode 26.4+. See the [Expo SDK compatibility table](https://docs.expo.dev/versions/latest/).

From the repository root:

```sh
cd mobile
npm ci
npm run web
```

The terminal prints the local web URL. The browser version is useful for reviewing the mobile layout and typed-answer flow. Use a native device to validate microphone permission, recording, playback, and application lifecycle behavior.

### Open on a phone with Expo Go

Install an [Expo Go version compatible with SDK 57](https://expo.dev/go), then run:

```sh
cd mobile
npm ci
npm start
```

Keep the phone and computer on the same network and scan the terminal QR code using Expo Go on Android or the iPhone camera. On current iPhone Expo Go releases, run `npx expo login` and sign into the same Expo account inside Expo Go before opening the project. The development server must remain running for this preview. The app itself does not ask for a MockInterview account. If Expo Go no longer supports SDK 57 on your device, use a native build below. [Expo environment setup](https://docs.expo.dev/get-started/set-up-your-environment/) · [Expo Go sign-in requirements](https://expo.dev/changelog/expo-go-57-login)

For an installed Android emulator or iOS simulator:

```sh
npm run android
npm run ios
```

These scripts explicitly use Expo Go and do not generate native project folders. The iOS simulator requires macOS and Xcode; an Android emulator requires Android Studio tooling.

### Create your own local native build

With the appropriate Xcode or Android SDK installed, run the matching command inside `mobile`:

```sh
npx expo run:ios
npx expo run:android
```

Expo generates the ignored `ios/` or `android/` project as needed and compiles the app locally. Add `--device` to select a connected phone. iOS devices require signing configuration. Local build and device-check outcomes are recorded in [VALIDATION.md](VALIDATION.md). These commands create development builds; store distribution has not been submitted. [Expo local development](https://docs.expo.dev/guides/local-app-development/)

## Check and export

See [VALIDATION.md](VALIDATION.md) for the completed checks and remaining release validation.

```sh
npm run typecheck
npm test
npx expo install --check
npm run export:web
npm run export:ios
npm run export:android
```

Exports are written to `dist-web/`, `dist-ios/`, and `dist-android/`. Native exports validate the JavaScript bundles and assets; they are **not installable app binaries**. Native permissions, audio, keyboard interaction, and safe areas still need an on-device smoke test before release.

The `xcode` tool’s transitive `uuid` dependency is overridden to the patched CommonJS-compatible 11.1.1 release. The upstream [UUID advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) affects earlier versions. Its `v4()` API, used to create Xcode project identifiers, remains compatible.

## Optional distribution builds

`eas.json` contains three build profiles: `simulator` for an iOS simulator or Android APK, `preview` for internal device distribution, and `production` for store binaries. No Expo owner, EAS project ID, signing credentials, store account, or submission is configured.

When you are ready to create a build, sign in with your own account and configure this project:

```sh
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform ios --profile simulator
```

Use `--profile preview` for an iPhone device build, or `--profile production` for store binaries. EAS may ask to create/link a project and configure signing. iPhone distribution needs Apple credentials and, for internal distribution, registered devices. The shared application identifier is `live.mockinterview.mobile`; verify ownership before distribution. Building does not publish the app. Store listings, privacy disclosures, physical-device validation, and submission are future release work. [EAS setup](https://docs.expo.dev/build/setup/) · [Build profiles](https://docs.expo.dev/build/eas-json/)

## Design references

- [Signal](https://signal.org/): familiar conversation bubbles, a clear composer, and a focused messaging experience inspired the one-question-at-a-time flow.
- [Yoodli](https://yoodli.ai/): approachable communication practice inspired short sessions and reflective coaching prompts.

The UI, copy, prompts, and code-native app icons are original to MockInterview. These are product references; the app does not integrate with either service. The original SVG icon sources and exported PNGs are in `assets/`.

## Audio and storage behavior

Microphone access is optional and requested when recording begins. `expo-audio` configures the iOS usage description and Android recording permission. Background recording and playback are disabled. Legacy Android shared-storage permissions are blocked because recordings use app-private storage. The web preview supports typed answers; recording and playback are available in the native app. Test native audio on both operating systems. See [Expo audio documentation](https://docs.expo.dev/versions/latest/sdk/audio/).
