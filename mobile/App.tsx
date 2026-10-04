import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { PracticeFeedback } from "./src/components/PracticeFeedback";
import { AnalyticsSettings } from "./src/components/AnalyticsSettings";
import { shareMobileResult } from "./src/lib/analytics";
import { colors, s } from "./src/theme";
import { Button, Icon, IconButton, IconName, Label } from "./src/components/ui";
import {
  AudioPlayback,
  VoiceAnswer,
  removeRecording,
} from "./src/components/VoiceAnswer";
import {
  topics,
  questions,
  getQuestion,
  getTopic,
  createSession,
  getSavedState,
  saveDraft,
  saveSession,
  setBookmark,
  deleteSession,
  sessionProgress,
  PracticeSession,
  PracticeAnswer,
  TopicId,
} from "./src/lib";

type Tab = "today" | "practice" | "saved";
const topicIcons: Record<TopicId, IconName> = {
  behavioral: "message-circle",
  career: "compass",
  technical: "code",
};
const topicNames: Record<TopicId, string> = {
  behavioral: "Tell your story",
  career: "Make your introduction",
  technical: "Explain your thinking",
};
const topicDescriptions: Record<TopicId, string> = {
  behavioral: "Real experiences. Clearer answers.",
  career: "Your next chapter starts with you.",
  technical: "Talk through the how and the why.",
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const answerFor = (session: PracticeSession, id: string): PracticeAnswer =>
  session.answers.find((a) => a.questionId === id) ?? {
    questionId: id,
    text: "",
    checked: [],
  };

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <PocketApp />
    </SafeAreaProvider>
  );
}
function PocketApp() {
  const insets = useSafeAreaInsets();
  const bookmarkPending = useRef(new Set<string>());
  const [tab, setTab] = useState<Tab>("today");
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<PracticeSession | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [review, setReview] = useState(false);
  const [hint, setHint] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<PracticeSession | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [info, setInfo] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PracticeSession | null>(
    null,
  );
  const [error, setError] = useState("");
  const [count, setCount] = useState<1 | 3>(3);
  const [savedFilter, setSavedFilter] = useState<"sessions" | "questions">(
    "sessions",
  );

  useEffect(() => {
    let mounted = true;
    getSavedState()
      .then((state) => {
        if (!mounted) return;
        setDraft(state.draft);
        setSessions(state.sessions);
        setBookmarks(state.bookmarks);
        if (state.storageWarnings.length)
          setError(state.storageWarnings.join(" "));
      })
      .catch(() =>
        setError(
          "Your saved practice could not be loaded. Please reopen the app before starting.",
        ),
      )
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const persist = (next: PracticeSession | null) => {
    if (saving) return;
    setDraft(next);
    void saveDraft(next).catch(() =>
      setError(
        "This change could not be saved on your device. Keep the app open and try again.",
      ),
    );
  };
  const updateAnswer = (changes: Partial<PracticeAnswer>) => {
    if (!draft || saving) return;
    const id = draft.questionIds[index];
    const answer = { ...answerFor(draft, id), ...changes };
    persist({
      ...draft,
      answers: [...draft.answers.filter((a) => a.questionId !== id), answer],
    });
  };
  const updateVoiceAnswer = async (changes: Partial<PracticeAnswer>) => {
    if (!draft) throw new Error("No active practice");
    const id = draft.questionIds[index];
    const answer = { ...answerFor(draft, id), ...changes };
    const next = {
      ...draft,
      answers: [...draft.answers.filter((a) => a.questionId !== id), answer],
    };
    // Persist the new file reference before VoiceAnswer removes an older recording.
    await saveDraft(next);
    setDraft(next);
  };
  const pause = useCallback(() => {
    if (voiceBusy || saving) return;
    setActive(false);
    setReview(false);
    setHint(false);
    setTab("today");
  }, [voiceBusy, saving]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (info || deleteTarget) return false;
      if (active) {
        pause();
        return true;
      }
      if (detail) {
        setDetail(null);
        setJustFinished(false);
        return true;
      }
      if (tab !== "today") {
        setTab("today");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [active, pause, detail, tab, info, deleteTarget]);

  const resume = () => {
    if (!draft) return;
    const unanswered = draft.questionIds.findIndex((id) => {
      const a = answerFor(draft, id);
      return !a.text.trim() && !a.recordingUri;
    });
    setIndex(
      draft.currentQuestionIndex ??
        Math.max(
          0,
          unanswered < 0 ? draft.questionIds.length - 1 : unanswered - 1,
        ),
    );
    setActive(true);
    setReview(false);
    setHint(false);
  };
  const start = (
    topicId: TopicId,
    selectedCount = count,
    questionId?: string,
  ) => {
    if (draft) {
      resume();
      return;
    }
    const recent = sessions.flatMap((session) =>
      [...session.questionIds].reverse(),
    );
    const next = createSession(topicId, selectedCount, recent);
    if (questionId) {
      next.questionIds = [questionId];
      next.answers = [{ questionId, text: "", checked: [] }];
    }
    persist(next);
    setIndex(0);
    setActive(true);
    setReview(false);
    setHint(false);
    setError("");
  };
  const toggleBookmark = async (id: string) => {
    if (bookmarkPending.current.has(id)) return;
    bookmarkPending.current.add(id);
    const next = !bookmarks.includes(id);
    try {
      await setBookmark(id, next);
      setBookmarks((previous) =>
        next
          ? [...new Set([...previous, id])]
          : previous.filter((value) => value !== id),
      );
    } catch {
      setError("This question could not be saved. Please try again.");
    } finally {
      bookmarkPending.current.delete(id);
    }
  };
  const finish = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const complete: PracticeSession = {
      ...draft,
      completedAt: new Date().toISOString(),
    };
    try {
      const pruned = await saveSession(complete);
      void shareMobileResult(complete);
      for (const session of pruned)
        for (const answer of session.answers)
          if (answer.recordingUri)
            await removeRecording(answer.recordingUri).catch(() => {});
      const state = await getSavedState();
      setSessions(state.sessions);
      setDraft(null);
      setActive(false);
      setDetail(complete);
      setJustFinished(true);
      setTab("saved");
      setError("");
    } catch {
      setError(
        "We could not save this practice. Your answers are still here. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  const nextQuestion = () => {
    if (draft && index + 1 < draft.questionIds.length) {
      persist({ ...draft, currentQuestionIndex: index + 1 });
      setIndex(index + 1);
      setReview(false);
      setHint(false);
    } else {
      void finish();
    }
  };
  const removeSession = async () => {
    if (!deleteTarget || saving) return;
    setSaving(true);
    try {
      if (deleteTarget.id === draft?.id) {
        await saveDraft(null);
        setDraft(null);
      } else {
        await deleteSession(deleteTarget.id);
        setSessions((previous) =>
          previous.filter((item) => item.id !== deleteTarget.id),
        );
      }
      for (const a of deleteTarget.answers)
        if (a.recordingUri) await removeRecording(a.recordingUri);
      if (detail?.id === deleteTarget.id) setDetail(null);
      setDeleteTarget(null);
      setError("");
    } catch {
      setError("This practice could not be fully removed. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  const openWebsite = () =>
    void Linking.openURL("https://mockinterview.live/interviews/").catch(() =>
      setError(
        "Unable to open the website. Visit mockinterview.live in your browser.",
      ),
    );
  const currentQuestion = draft
    ? getQuestion(draft.questionIds[index])
    : undefined;
  const currentAnswer =
    draft && currentQuestion ? answerFor(draft, currentQuestion.id) : undefined;
  const canReview =
    !!currentAnswer &&
    (!!currentAnswer.text.trim() || !!currentAnswer.recordingUri);

  const header = (
    <View style={s.between}>
      <View style={s.row}>
        <View
          style={[
            s.iconBox,
            {
              backgroundColor: colors.accent,
              width: 34,
              height: 34,
              borderRadius: 11,
            },
          ]}
        >
          <Text
            style={{
              fontSize: 24,
              lineHeight: 28,
              fontWeight: "600",
              color: "#fff",
            }}
          >
            m
          </Text>
        </View>
        <Text
          style={{
            fontSize: 17,
            fontWeight: "600",
            letterSpacing: -0.5,
            color: colors.ink,
          }}
        >
          mockinterview
          <Text style={{ fontWeight: "400", color: colors.muted }}>.live</Text>
        </Text>
      </View>
      <IconButton
        name="info"
        label="About pocket practice"
        onPress={() => setInfo(true)}
      />
    </View>
  );
  const questionBookmark = (id: string) => (
    <IconButton
      name={bookmarks.includes(id) ? "check" : "bookmark"}
      label={bookmarks.includes(id) ? "Unsave question" : "Save question"}
      onPress={() => void toggleBookmark(id)}
    />
  );
  const resumeCard = draft && (
    <View style={[s.card, { backgroundColor: colors.soft }]}>
      <View style={s.between}>
        <Label>Ready when you are</Label>
        <IconButton
          name="x"
          label="Discard unfinished practice"
          onPress={() => setDeleteTarget(draft)}
        />
      </View>
      <Text style={s.h3}>Pick up where you left off</Text>
      <Text style={s.muted}>
        {getTopic(draft.topicId)?.title} · {sessionProgress(draft).answered} of{" "}
        {draft.questionIds.length} answered
      </Text>
      <Button onPress={resume} icon="arrow-right">
        Continue practice
      </Button>
    </View>
  );

  if (!ready)
    return (
      <View
        style={[s.root, { justifyContent: "center", alignItems: "center" }]}
      >
        <ActivityIndicator color={colors.accent} />
        <Text style={[s.muted, { marginTop: 12 }]}>
          Opening your practice space…
        </Text>
      </View>
    );

  return (
    <View style={s.root}>
      <View
        style={[
          s.frame,
          { paddingTop: insets.top, paddingBottom: active ? insets.bottom : 0 },
        ]}
      >
        {!!error && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notice"
            onPress={() => setError("")}
            style={{ padding: 12 }}
          >
            <Text accessibilityRole="alert" style={s.alert}>
              {error}
            </Text>
          </Pressable>
        )}
        {active && draft && currentQuestion && currentAnswer ? (
          <KeyboardAvoidingView
            style={s.grow}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <View
              style={[s.between, { paddingHorizontal: 16, paddingVertical: 8 }]}
            >
              <IconButton
                name="chevron-left"
                label="Pause and return home"
                onPress={pause}
                disabled={voiceBusy || saving}
              />
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={s.h3}>{getTopic(draft.topicId)?.title}</Text>
                <Text style={s.small}>
                  Question {index + 1} of {draft.questionIds.length} · Your pace
                </Text>
              </View>
              {questionBookmark(currentQuestion.id)}
            </View>
            <View
              accessibilityLabel={`Question ${index + 1} of ${draft.questionIds.length}`}
              style={{ height: 3, backgroundColor: colors.line }}
            >
              <View
                style={{
                  height: 3,
                  width: `${((index + 1) / draft.questionIds.length) * 100}%`,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
            <ScrollView
              key={`${currentQuestion.id}-${review}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[s.page, { paddingTop: 24, gap: 20 }]}
            >
              <View style={[s.row, { justifyContent: "center" }]}>
                <Icon name="feather" size={13} />
                <Text style={s.small}>A little space to think out loud.</Text>
              </View>
              <View style={s.section}>
                <View style={s.row}>
                  <View
                    style={[
                      s.iconBox,
                      { width: 28, height: 28, borderRadius: 10 },
                    ]}
                  >
                    <Icon name="message-circle" size={15} />
                  </View>
                  <Label>Practice prompt</Label>
                </View>
                <View style={s.coachBubble}>
                  <Text
                    style={[
                      s.h2,
                      { fontSize: 23, lineHeight: 32, fontWeight: "500" },
                    ]}
                  >
                    {currentQuestion.prompt}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    aria-expanded={hint}
                    accessibilityState={{ expanded: hint }}
                    onPress={() => setHint(!hint)}
                    style={[s.row, { minHeight: 44 }]}
                  >
                    <Icon name="sun" size={17} />
                    <Text
                      style={[
                        s.small,
                        { color: colors.accent, fontWeight: "600", flex: 1 },
                      ]}
                    >
                      {hint
                        ? "Hide a little guidance"
                        : "Need a little guidance?"}
                    </Text>
                    <Icon
                      name={hint ? "chevron-up" : "chevron-down"}
                      size={16}
                    />
                  </Pressable>
                  {hint && <Text style={s.muted}>{currentQuestion.hint}</Text>}
                </View>
              </View>
              {review ? (
                <>
                  <View style={s.answerBubble}>
                    <Label>Your answer</Label>
                    {!!currentAnswer.text && (
                      <Text style={s.text}>{currentAnswer.text}</Text>
                    )}
                    {currentAnswer.recordingUri && (
                      <AudioPlayback
                        uri={currentAnswer.recordingUri}
                        durationSeconds={currentAnswer.durationSeconds}
                      />
                    )}
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving}
                      onPress={() => setReview(false)}
                      style={{ minHeight: 44, justifyContent: "center" }}
                    >
                      <Text
                        style={[
                          s.small,
                          { color: colors.accent, fontWeight: "600" },
                        ]}
                      >
                        Edit my answer
                      </Text>
                    </Pressable>
                  </View>
                  <View style={s.section}>
                    <Label>A moment to reflect</Label>
                    <Text style={s.h2}>What came through clearly?</Text>
                    <Text style={s.muted}>
                      Check what you covered. This is your own review; there’s
                      no AI score.
                    </Text>
                    {currentQuestion.checkpoints.map((checkpoint) => {
                      const checked =
                        currentAnswer.checked.includes(checkpoint);
                      return (
                        <Pressable
                          key={checkpoint}
                          disabled={saving}
                          accessibilityRole="checkbox"
                          aria-checked={checked}
                          accessibilityState={{ checked, disabled: saving }}
                          onPress={() =>
                            updateAnswer({
                              checked: checked
                                ? currentAnswer.checked.filter(
                                    (item) => item !== checkpoint,
                                  )
                                : [...currentAnswer.checked, checkpoint],
                            })
                          }
                          style={[
                            s.row,
                            {
                              paddingVertical: 13,
                              paddingHorizontal: 15,
                              borderWidth: 1,
                              borderColor: checked
                                ? colors.accent
                                : colors.line,
                              borderRadius: 14,
                              backgroundColor: checked
                                ? colors.soft
                                : colors.panel,
                            },
                          ]}
                        >
                          <View
                            style={{
                              width: 23,
                              height: 23,
                              borderRadius: 7,
                              borderWidth: 1,
                              borderColor: checked
                                ? colors.accent
                                : colors.line,
                              backgroundColor: checked
                                ? colors.accent
                                : colors.panel,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {checked && (
                              <Icon name="check" color="#fff" size={15} />
                            )}
                          </View>
                          <Text style={[s.text, { flex: 1, fontSize: 14 }]}>
                            {checkpoint}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={s.soft}>
                    <View style={s.row}>
                      <Icon name="corner-down-right" size={17} />
                      <Label>One step deeper</Label>
                    </View>
                    <Text style={s.text}>{currentQuestion.followUp}</Text>
                  </View>
                  {index === draft.questionIds.length - 1 && (
                    <View style={s.section}>
                      <Text style={s.h3}>
                        One thing to try next time{" "}
                        <Text style={s.small}>(optional)</Text>
                      </Text>
                      <TextInput
                        editable={!saving}
                        accessibilityLabel="One thing to try next time"
                        value={draft.reflection ?? ""}
                        onChangeText={(text) =>
                          persist({ ...draft, reflection: text })
                        }
                        maxLength={1000}
                        multiline
                        placeholder="I’ll make my example more specific…"
                        placeholderTextColor={colors.muted}
                        style={[s.input, { minHeight: 90 }]}
                      />
                    </View>
                  )}
                  <Button
                    onPress={nextQuestion}
                    icon={
                      index === draft.questionIds.length - 1
                        ? "check"
                        : "arrow-right"
                    }
                    disabled={saving}
                  >
                    {saving
                      ? "Saving…"
                      : index === draft.questionIds.length - 1
                        ? "Finish & save"
                        : "Next question"}
                  </Button>
                </>
              ) : (
                <View style={s.section}>
                  <View style={s.between}>
                    <Label>Your turn</Label>
                    <Text style={s.small}>No timer. No pressure.</Text>
                  </View>
                  <TextInput
                    accessibilityLabel="Your answer"
                    value={currentAnswer.text}
                    onChangeText={(text) => updateAnswer({ text })}
                    placeholder="Start with a moment that comes to mind…"
                    placeholderTextColor={colors.muted}
                    multiline
                    maxLength={8000}
                    style={[s.input, { minHeight: 165 }]}
                    editable={!voiceBusy}
                  />
                  <VoiceAnswer
                    key={`${draft.id}-${currentQuestion.id}`}
                    uri={currentAnswer.recordingUri}
                    durationSeconds={currentAnswer.durationSeconds}
                    onRecorded={(uri, durationSeconds) =>
                      updateVoiceAnswer({ recordingUri: uri, durationSeconds })
                    }
                    onRemove={() =>
                      updateVoiceAnswer({
                        recordingUri: undefined,
                        durationSeconds: undefined,
                      })
                    }
                    onBusyChange={setVoiceBusy}
                  />
                  <Button
                    onPress={() => setReview(true)}
                    disabled={!canReview || voiceBusy}
                    icon="arrow-right"
                  >
                    Review my answer
                  </Button>
                  <Text style={[s.small, { textAlign: "center" }]}>
                    Saved on this device as you go.
                  </Text>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        ) : detail ? (
          <>
            <View
              style={[s.between, { paddingHorizontal: 16, paddingVertical: 8 }]}
            >
              <IconButton
                name="chevron-left"
                label="Back to saved practice"
                onPress={() => {
                  setDetail(null);
                  setJustFinished(false);
                  setTab("saved");
                }}
              />
              <Text style={s.h3}>Your practice</Text>
              <IconButton
                name="trash-2"
                label="Delete this practice"
                onPress={() => setDeleteTarget(detail)}
              />
            </View>
            <ScrollView contentContainerStyle={s.page}>
              <View
                style={[
                  s.section,
                  { alignItems: "center", paddingVertical: 10 },
                ]}
              >
                <View
                  style={[
                    s.iconBox,
                    { width: 64, height: 64, borderRadius: 32 },
                  ]}
                >
                  <Icon name="check" size={28} />
                </View>
                <Label>
                  {justFinished
                    ? "A little progress, made"
                    : "Saved on this device"}
                </Label>
                <Text style={[s.title, { textAlign: "center" }]}>
                  {justFinished
                    ? "You showed up.\nThat counts."
                    : "A clearer next step."}
                </Text>
                <Text style={[s.muted, { textAlign: "center" }]}>
                  {getTopic(detail.topicId)?.title} ·{" "}
                  {detail.questionIds.length}{" "}
                  {detail.questionIds.length === 1 ? "question" : "questions"} ·{" "}
                  {dateLabel(detail.completedAt ?? detail.startedAt)}
                </Text>
              </View>
              <PracticeFeedback
                key={detail.id}
                onConnect={() => setInfo(true)}
              />
              {!!detail.reflection && (
                <View style={s.soft}>
                  <Label>Next time, I’ll…</Label>
                  <Text style={s.text}>{detail.reflection}</Text>
                </View>
              )}
              {detail.questionIds.map((id, i) => {
                const question = getQuestion(id);
                const answer = answerFor(detail, id);
                if (!question) return null;
                return (
                  <View key={id} style={s.card}>
                    <View style={s.between}>
                      <Label>{`Question ${i + 1}`}</Label>
                      {questionBookmark(id)}
                    </View>
                    <Text style={s.h3}>{question.prompt}</Text>
                    {!!answer.text && <Text style={s.text}>{answer.text}</Text>}
                    {answer.recordingUri && (
                      <AudioPlayback
                        uri={answer.recordingUri}
                        durationSeconds={answer.durationSeconds}
                      />
                    )}
                    <View style={s.divider} />
                    <Text style={s.small}>
                      Your self-review · {answer.checked.length} of{" "}
                      {question.checkpoints.length} points covered
                    </Text>
                    {answer.checked.map((item) => (
                      <View key={item} style={s.row}>
                        <Icon name="check" size={14} />
                        <Text style={[s.small, { flex: 1 }]}>{item}</Text>
                      </View>
                    ))}
                    <Text style={s.muted}>{question.followUp}</Text>
                  </View>
                );
              })}
              <Button
                onPress={() => {
                  setDetail(null);
                  setJustFinished(false);
                  setTab("today");
                }}
                icon="home"
              >
                Back to today
              </Button>
            </ScrollView>
          </>
        ) : (
          <>
            <ScrollView
              key={tab}
              contentContainerStyle={s.page}
              keyboardShouldPersistTaps="handled"
            >
              {header}
              {tab === "today" ? (
                <>
                  <View style={[s.section, { gap: 8 }]}>
                    <Label>Your pocket practice</Label>
                    <Text style={s.title}>
                      A little practice.{"\n"}A clearer next step.
                    </Text>
                    <Text style={s.muted}>
                      Big interview energy. Small, everyday steps.
                    </Text>
                  </View>
                  {resumeCard || (
                    <View
                      style={{
                        backgroundColor: colors.ink,
                        borderRadius: 25,
                        padding: 24,
                        gap: 20,
                        overflow: "hidden",
                      }}
                    >
                      <View style={s.between}>
                        <Text style={[s.eyebrow, { color: colors.leaf }]}>
                          A MOMENT FOR YOU
                        </Text>
                        <View
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            backgroundColor: "#3b5141",
                            borderRadius: 20,
                          }}
                        >
                          <Text style={{ color: "#e3edd9", fontSize: 11 }}>
                            ~5 minutes
                          </Text>
                        </View>
                      </View>
                      <View style={{ gap: 12 }}>
                        <View
                          style={{
                            alignSelf: "flex-start",
                            backgroundColor: "#3a5142",
                            borderRadius: 16,
                            borderTopLeftRadius: 3,
                            padding: 13,
                            flexDirection: "row",
                            gap: 8,
                          }}
                        >
                          <Icon
                            name="message-circle"
                            color={colors.leaf}
                            size={20}
                          />
                          <View
                            style={{
                              width: 92,
                              gap: 6,
                              justifyContent: "center",
                            }}
                          >
                            <View
                              style={{
                                height: 4,
                                width: 88,
                                backgroundColor: "#b3c8ad",
                                borderRadius: 4,
                              }}
                            />
                            <View
                              style={{
                                height: 4,
                                width: 60,
                                backgroundColor: "#809d80",
                                borderRadius: 4,
                              }}
                            />
                          </View>
                        </View>
                        <Text
                          style={{
                            fontSize: 27,
                            lineHeight: 32,
                            letterSpacing: -0.6,
                            color: "#fff",
                            fontWeight: "500",
                          }}
                        >
                          Find the words.{"\n"}Build your confidence.
                        </Text>
                        <Text
                          style={{
                            fontSize: 14,
                            lineHeight: 22,
                            color: "#d0ddca",
                          }}
                        >
                          Three prompts. Space to answer. One thing to take into
                          your next interview.
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => start("behavioral", 3)}
                        style={({ pressed }) => [
                          s.button,
                          {
                            backgroundColor: colors.leaf,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={[s.buttonText, { color: colors.ink }]}>
                          Start a quick practice
                        </Text>
                        <Icon name="arrow-right" color={colors.ink} size={18} />
                      </Pressable>
                    </View>
                  )}
                  <View style={s.section}>
                    <View style={s.between}>
                      <Text style={s.h2}>Make it a small habit</Text>
                      <Text style={s.small}>
                        {sessions.length}{" "}
                        {sessions.length === 1 ? "practice" : "practices"} saved
                      </Text>
                    </View>
                    <View
                      style={[
                        s.card,
                        {
                          padding: 16,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          gap: 4,
                        },
                      ]}
                    >
                      {Array.from({ length: 7 }, (_, i) => {
                        const day = new Date();
                        day.setHours(12, 0, 0, 0);
                        day.setDate(day.getDate() - 6 + i);
                        const practiced = sessions.some(
                          (item) =>
                            new Date(
                              item.completedAt ?? item.startedAt,
                            ).toDateString() === day.toDateString(),
                        );
                        return (
                          <View
                            key={i}
                            accessibilityLabel={`${day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}: ${practiced ? "practiced" : "no practice yet"}`}
                            style={{ alignItems: "center", gap: 10, flex: 1 }}
                          >
                            <Text style={[s.small, { fontSize: 10 }]}>
                              {day.toLocaleDateString(undefined, {
                                weekday: "narrow",
                              })}
                            </Text>
                            <View
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: 15,
                                backgroundColor: practiced
                                  ? colors.accent
                                  : i === 6
                                    ? colors.soft
                                    : colors.studio,
                                borderWidth: i === 6 ? 1 : 0,
                                borderColor: colors.accent,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {practiced ? (
                                <Icon name="check" size={14} color="#fff" />
                              ) : (
                                <Text style={[s.small, { fontSize: 11 }]}>
                                  {day.getDate()}
                                </Text>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  <View style={s.section}>
                    <View style={s.between}>
                      <Text style={s.h2}>Just one question?</Text>
                      <Icon name="sun" size={18} />
                    </View>
                    <View style={s.card}>
                      <Label>Today’s warm-up</Label>
                      <Text
                        style={[
                          s.h3,
                          { fontWeight: "500", fontSize: 18, lineHeight: 27 },
                        ]}
                      >
                        {
                          questions[new Date().getDate() % questions.length]
                            .prompt
                        }
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          const q =
                            questions[new Date().getDate() % questions.length];
                          start(q.topicId, 1, q.id);
                        }}
                        style={[s.row, { minHeight: 46 }]}
                      >
                        <Text
                          style={{
                            color: colors.accent,
                            fontWeight: "600",
                            fontSize: 14,
                          }}
                        >
                          {draft ? "Continue your practice" : "Give it a try"}
                        </Text>
                        <Icon name="arrow-up-right" size={17} />
                      </Pressable>
                    </View>
                  </View>
                </>
              ) : tab === "practice" ? (
                <>
                  <View style={s.section}>
                    <Label>A little preparation goes a long way</Label>
                    <Text style={s.title}>What’s on your mind?</Text>
                    <Text style={s.muted}>
                      Pick a focus. We’ll keep it simple.
                    </Text>
                  </View>
                  {resumeCard}
                  <View style={s.section}>
                    <Label>How much time do you have?</Label>
                    <View style={[s.row, { gap: 10 }]}>
                      {(
                        [
                          { n: 1, label: "1 question · ~2 min" },
                          { n: 3, label: "3 questions · ~5 min" },
                        ] as const
                      ).map((item) => (
                        <Pressable
                          key={item.n}
                          accessibilityRole="radio"
                          aria-checked={count === item.n}
                          accessibilityState={{ checked: count === item.n }}
                          onPress={() => setCount(item.n)}
                          style={[
                            s.chip,
                            s.grow,
                            count === item.n && s.chipActive,
                          ]}
                        >
                          <Text
                            style={[
                              s.small,
                              {
                                fontWeight: "600",
                                color: count === item.n ? "#fff" : colors.ink,
                              },
                            ]}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <View style={s.section}>
                    {topics.map((topic) => (
                      <Pressable
                        key={topic.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${topic.title}: ${draft ? "continue unfinished practice" : `start ${count} question practice`}`}
                        onPress={() => start(topic.id)}
                        style={({ pressed }) => [
                          s.card,
                          { padding: 20, opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <View style={s.between}>
                          <View
                            style={[
                              s.iconBox,
                              {
                                backgroundColor:
                                  topic.id === "career"
                                    ? colors.warm
                                    : colors.soft,
                              },
                            ]}
                          >
                            <Icon name={topicIcons[topic.id]} />
                          </View>
                          <Icon name="arrow-up-right" size={19} />
                        </View>
                        <View style={{ gap: 5 }}>
                          <Label>{topic.title}</Label>
                          <Text style={s.h2}>{topicNames[topic.id]}</Text>
                          <Text style={s.muted}>
                            {topicDescriptions[topic.id]}
                          </Text>
                        </View>
                        <Text style={s.small}>
                          {
                            questions.filter((q) => q.topicId === topic.id)
                              .length
                          }{" "}
                          prompts to come back to
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={[s.soft, { gap: 12 }]}>
                    <Text style={s.h3}>Ready for a full interview?</Text>
                    <Text style={s.muted}>
                      Meet a live AI interviewer on the website. Your account
                      and full reports live there.
                    </Text>
                    <Button ghost onPress={openWebsite} icon="external-link">
                      Open MockInterview
                    </Button>
                  </View>
                </>
              ) : (
                <>
                  <View style={s.section}>
                    <Label>Little steps, kept together</Label>
                    <Text style={s.title}>Your practice, saved.</Text>
                    <Text style={s.muted}>
                      Your latest 30 practices. A little progress to return to.
                    </Text>
                  </View>
                  <View style={s.row}>
                    {(["sessions", "questions"] as const).map((value) => (
                      <Pressable
                        key={value}
                        accessibilityRole="tab"
                        aria-selected={savedFilter === value}
                        accessibilityState={{ selected: savedFilter === value }}
                        onPress={() => setSavedFilter(value)}
                        style={[s.chip, savedFilter === value && s.chipActive]}
                      >
                        <Text
                          style={[
                            s.small,
                            {
                              fontWeight: "600",
                              color:
                                savedFilter === value ? "#fff" : colors.ink,
                            },
                          ]}
                        >
                          {value === "sessions"
                            ? `Practice (${sessions.length})`
                            : `Questions (${bookmarks.length})`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {savedFilter === "sessions" ? (
                    sessions.length ? (
                      sessions.map((session) => (
                        <Pressable
                          key={session.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Review ${getTopic(session.topicId)?.title} practice from ${dateLabel(session.completedAt ?? session.startedAt)}`}
                          onPress={() => {
                            setDetail(session);
                            setJustFinished(false);
                          }}
                          style={({ pressed }) => [
                            s.card,
                            { opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <View style={s.row}>
                            <View style={s.iconBox}>
                              <Icon name={topicIcons[session.topicId]} />
                            </View>
                            <View style={[s.grow, { gap: 4 }]}>
                              <Text style={s.h3}>
                                {getTopic(session.topicId)?.title}
                              </Text>
                              <Text style={s.small}>
                                {dateLabel(
                                  session.completedAt ?? session.startedAt,
                                )}{" "}
                                · {session.questionIds.length}{" "}
                                {session.questionIds.length === 1
                                  ? "question"
                                  : "questions"}
                              </Text>
                            </View>
                            <Icon name="chevron-right" size={18} />
                          </View>
                          {!!session.reflection && (
                            <Text style={s.muted} numberOfLines={2}>
                              {session.reflection}
                            </Text>
                          )}
                        </Pressable>
                      ))
                    ) : (
                      <EmptyState
                        icon="book-open"
                        title="Your next step starts here."
                        text="Finish a short practice and your answers and reflections will be waiting here."
                        action="Find a practice"
                        onPress={() => setTab("practice")}
                      />
                    )
                  ) : bookmarks.length ? (
                    bookmarks.map((id) => {
                      const q = getQuestion(id);
                      return (
                        q && (
                          <View key={id} style={s.card}>
                            <View style={s.between}>
                              <Label>
                                {getTopic(q.topicId)?.title ?? "Question"}
                              </Label>
                              {questionBookmark(id)}
                            </View>
                            <Text style={s.h3}>{q.prompt}</Text>
                            <Button
                              ghost
                              onPress={() => start(q.topicId, 1, q.id)}
                              icon="arrow-right"
                            >
                              {draft
                                ? "Continue unfinished practice"
                                : "Practice this question"}
                            </Button>
                          </View>
                        )
                      );
                    })
                  ) : (
                    <EmptyState
                      icon="bookmark"
                      title="Keep a good question."
                      text="Tap the bookmark during practice to save a question you’d like to revisit."
                      action="Explore questions"
                      onPress={() => setTab("practice")}
                    />
                  )}
                  <View
                    style={[s.row, { justifyContent: "center", paddingTop: 8 }]}
                  >
                    <Icon name="smartphone" size={14} />
                    <Text style={s.small}>
                      Stored on this device. No account needed.
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>
            <View
              accessibilityRole="tablist"
              style={[s.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}
            >
              {(
                [
                  { id: "today", icon: "sun", label: "Today" },
                  { id: "practice", icon: "message-circle", label: "Practice" },
                  { id: "saved", icon: "bookmark", label: "Saved" },
                ] as const
              ).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityLabel={item.label}
                  aria-selected={tab === item.id}
                  accessibilityState={{ selected: tab === item.id }}
                  onPress={() => setTab(item.id)}
                  style={s.navItem}
                >
                  <View
                    style={{
                      borderRadius: 20,
                      paddingHorizontal: 20,
                      paddingVertical: 5,
                      backgroundColor:
                        tab === item.id ? colors.soft : "transparent",
                    }}
                  >
                    <Icon
                      name={item.icon}
                      color={tab === item.id ? colors.accent : colors.muted}
                    />
                  </View>
                  <Text
                    style={[
                      s.navText,
                      tab === item.id && {
                        color: colors.accent,
                        fontWeight: "700",
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <Modal
          visible={info}
          transparent
          animationType="slide"
          onRequestClose={() => setInfo(false)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "flex-end",
              backgroundColor: "#10251966",
            }}
          >
            <ScrollView
              style={{
                maxHeight: "92%",
                maxWidth: 540,
                width: "100%",
                alignSelf: "center",
                backgroundColor: colors.panel,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
              }}
              contentContainerStyle={[
                s.card,
                {
                  maxWidth: 540,
                  width: "100%",
                  alignSelf: "center",
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  paddingBottom: Math.max(insets.bottom, 24),
                  gap: 20,
                },
              ]}
            >
              <View style={s.between}>
                <Label>MockInterview · Pocket practice</Label>
                <IconButton
                  name="x"
                  label="Close about"
                  onPress={() => setInfo(false)}
                />
              </View>
              <Text style={s.title}>A quieter way to prepare.</Text>
              <Text style={s.text}>
                Short prompts, your own words, and a moment to reflect. Practice
                works offline with no account or subscription.
              </Text>
              <Text style={s.muted}>
                This companion offers guided self-review. It doesn’t analyze,
                transcribe, or score your answers. Open the website for live AI
                interviews.
              </Text>
              <View style={s.soft}>
                <Text style={s.h3}>Yours to keep. Yours to delete.</Text>
                <Text style={s.muted}>
                  Answers and recordings are saved in this app on this device.
                  With Share analytics enabled, new results also go privately to
                  the project admin. They don’t sync to your website history.
                  You can delete a practice from its saved review. Uninstalling
                  the app removes its local data; your device’s backup settings
                  may keep a copy.
                </Text>
              </View>
              <AnalyticsSettings />
              <Button onPress={openWebsite} icon="external-link">
                Visit mockinterview.live
              </Button>
              <Button ghost onPress={() => setInfo(false)}>
                Back to practice
              </Button>
            </ScrollView>
          </View>
        </Modal>
        <Modal
          visible={!!deleteTarget}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!saving) setDeleteTarget(null);
          }}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: 24,
              backgroundColor: "#10251966",
            }}
          >
            <View
              style={[
                s.card,
                { maxWidth: 480, width: "100%", alignSelf: "center", gap: 18 },
              ]}
            >
              <Text style={s.h2}>
                {deleteTarget?.id === draft?.id
                  ? "Discard unfinished practice?"
                  : "Delete this practice?"}
              </Text>
              <Text style={s.muted}>
                This removes its answers, recordings, and reflection from the
                app. Saved question bookmarks will stay.
              </Text>
              {!!error && (
                <Text accessibilityRole="alert" style={s.alert}>
                  {error}
                </Text>
              )}
              <Button onPress={() => void removeSession()} disabled={saving}>
                {saving ? "Removing…" : "Remove practice"}
              </Button>
              <Button
                ghost
                onPress={() => setDeleteTarget(null)}
                disabled={saving}
              >
                Keep it
              </Button>
            </View>
          </View>
        </Modal>
      </View>
    </View>
  );
}
function EmptyState({
  icon,
  title,
  text,
  action,
  onPress,
}: {
  icon: IconName;
  title: string;
  text: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View
      style={[s.card, { paddingVertical: 30, gap: 18, alignItems: "center" }]}
    >
      <View style={[s.iconBox, { width: 58, height: 58, borderRadius: 20 }]}>
        <Icon name={icon} size={25} />
      </View>
      <Text style={[s.h2, { textAlign: "center" }]}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>{text}</Text>
      <Button ghost onPress={onPress} icon="arrow-right">
        {action}
      </Button>
    </View>
  );
}
