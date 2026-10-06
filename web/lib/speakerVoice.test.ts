import { describe, expect, it } from "vitest";
import { preferredSpeakerVoice } from "./speakerVoice";
const voice = (name: string, lang = "en-US", isDefault = false) =>
  ({ name, lang, default: isDefault }) as SpeechSynthesisVoice;

describe("speaker test voice selection", () => {
  it("prefers natural speech over the default voice", () => {
    const natural = voice("Microsoft Jenny Online (Natural)");
    expect(
      preferredSpeakerVoice([voice("Microsoft David", "en-US", true), natural]),
    ).toBe(natural);
  });
  it("prefers a warm installed voice and avoids the wrong language", () => {
    const warm = voice("Samantha");
    expect(
      preferredSpeakerVoice([
        voice("Premium", "fr-FR"),
        voice("Default"),
        warm,
      ]),
    ).toBe(warm);
  });
  it("returns no voice when an English sample cannot use a matching voice", () => {
    expect(preferredSpeakerVoice([voice("Premium", "fr-FR")])).toBeUndefined();
    expect(preferredSpeakerVoice([])).toBeUndefined();
    expect(
      preferredSpeakerVoice([voice("eSpeak", "en", true)]),
    ).toBeUndefined();
  });
});
