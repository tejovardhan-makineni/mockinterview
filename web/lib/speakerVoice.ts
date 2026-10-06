// Pick a natural English voice when the operating system offers one. Keeping
// this local avoids a model request just to check a user's output device.
export function preferredSpeakerVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter((voice) => /^en(?:-|_|$)/i.test(voice.lang));
  const score = (voice: SpeechSynthesisVoice) =>
    (/natural|neural|premium|enhanced/i.test(voice.name) ? 40 : 0) +
    (/samantha|ava|jenny|aria|serena|karen|google.*english/i.test(voice.name)
      ? 20
      : 0) +
    (/^en-US$/i.test(voice.lang) ? 4 : 0) +
    (voice.default ? 1 : 0);
  const best = english.slice().sort((a, b) => score(b) - score(a))[0];
  // Basic voices (common on Linux) make a poor speaker sample. The caller
  // plays a gentle chime when no natural or familiar installed voice exists.
  return best && score(best) >= 20 ? best : undefined;
}
