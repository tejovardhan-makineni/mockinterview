import React, { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { s } from "../theme";
import { Button } from "./ui";
import {
  analyticsConfigured,
  mobileSharingEnabled,
  mobileSharingConnected,
  setMobileSharing,
  connectMobileSharing,
  disconnectMobileSharing,
  deleteMobileAnalytics,
} from "../lib/analytics";
export function AnalyticsSettings() {
  const [enabled, setEnabled] = useState(mobileSharingEnabled());
  const [connected, setConnected] = useState(mobileSharingConnected());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <View style={s.soft}>
      <View style={s.between}>
        <Text style={s.h3}>Share analytics</Text>
        <Switch
          accessibilityLabel="Share analytics"
          value={enabled}
          disabled={!analyticsConfigured()}
          onValueChange={(value) => {
            setEnabled(value);
            setMobileSharing(value);
          }}
        />
      </View>
      <Text style={s.small}>
        Share new practice results, reflections and metrics privately with the
        admin. Optional; offline uploads are skipped. Audio stays on your
        device.
      </Text>
      {!analyticsConfigured() ? (
        <Text style={s.small}>
          Sharing is not configured in this build. Practice stays on your
          device.
        </Text>
      ) : !connected ? (
        <>
          <Text style={s.small}>
            Connect a hosted account. Sharing and sign-in last for this app
            session.
          </Text>
          <TextInput
            accessibilityLabel="Hosted account email"
            placeholder="Hosted account email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={s.input}
          />
          <TextInput
            accessibilityLabel="Hosted account password"
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={s.input}
          />
          <Button
            disabled={busy || !email || !password}
            ghost
            onPress={() => {
              setBusy(true);
              void connectMobileSharing(email, password)
                .then(() => {
                  setConnected(true);
                  setMessage(
                    "Connected. Enable Share analytics to contribute new results.",
                  );
                })
                .catch((e) => setMessage(e.message))
                .finally(() => {
                  setPassword("");
                  setBusy(false);
                });
            }}
          >
            Connect sharing
          </Button>
        </>
      ) : (
        <Button
          ghost
          onPress={() => {
            disconnectMobileSharing();
            setConnected(false);
            setEnabled(false);
          }}
        >
          Disconnect sharing
        </Button>
      )}
      {connected && (
        <Button
          ghost
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setEnabled(false);
            void deleteMobileAnalytics()
              .then(() =>
                setMessage("Shared analytics deleted. Sharing is off."),
              )
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Delete shared analytics
        </Button>
      )}
      {!!message && (
        <Text accessibilityRole="alert" style={s.small}>
          {message}
        </Text>
      )}
    </View>
  );
}
