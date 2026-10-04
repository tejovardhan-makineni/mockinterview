import { StyleSheet, Text, View } from "react-native";

export interface VoiceAnswerProps {
  uri?: string;
  durationSeconds?: number;
  onRecorded: (uri: string, durationSeconds: number) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

export async function removeRecording(_uri: string): Promise<void> {
  // A browser preview cannot access recordings stored in the native app.
}

export function AudioPlayback(_props: {
  uri: string;
  durationSeconds?: number;
}) {
  return (
    <Text style={styles.note}>
      Listen to this recording in the iOS or Android app on the device where you
      saved it.
    </Text>
  );
}

export function VoiceAnswer(_props: VoiceAnswerProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.note}>
        Voice recording is available in the iOS and Android app. You can type
        here.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 14, borderRadius: 14, backgroundColor: "#edf2eb" },
  note: { color: "#526356", fontSize: 13, lineHeight: 19 },
});
