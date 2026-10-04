import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { s } from "../theme";
import { Button } from "./ui";
import { mobileSharingConnected, sendMobileFeedback } from "../lib/analytics";
export function PracticeFeedback({ onConnect }: { onConnect: () => void }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <View style={s.soft}>
      <Text style={s.h3}>How can we improve practice?</Text>
      <Text style={s.small}>
        A quick note goes privately to the project admin. Your answers and
        recordings are not attached.
      </Text>
      <TextInput
        accessibilityLabel="Product feedback"
        placeholder="What helped? What got in your way?"
        multiline
        maxLength={5000}
        value={note}
        onChangeText={setNote}
        style={s.input}
      />
      <Button
        ghost
        disabled={busy || !note.trim()}
        onPress={() => {
          if (!mobileSharingConnected()) {
            onConnect();
            return;
          }
          setBusy(true);
          void sendMobileFeedback(note)
            .then(() => {
              setNote("");
              setMessage("Thank you. Your feedback was sent.");
            })
            .catch((e) => setMessage(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Send private feedback
      </Button>
      {!!message && (
        <Text accessibilityRole="alert" style={s.small}>
          {message}
        </Text>
      )}
    </View>
  );
}
