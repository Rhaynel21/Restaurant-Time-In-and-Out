import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { Colors } from "@/constants/theme";
import {
  DeviceAlarm,
  DeviceStatus,
  acknowledgeAlarm,
  isDeviceOnline,
  subscribeAlarms,
  subscribeDevices,
} from "@/lib/devices";

function timeAgo(date: Date | null) {
  if (!date) return "never";
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DevicesTab() {
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [alarms, setAlarms] = useState<DeviceAlarm[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribeDevices(setDevices, () => setDevices([])), []);
  useEffect(() => subscribeAlarms(setAlarms, () => setAlarms([])), []);

  const ack = async (id: string) => {
    try {
      setBusy(id);
      await acknowledgeAlarm(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <SectionTitle>Biometric Devices</SectionTitle>
      {devices.length === 0 ? (
        <EmptyState icon="cctv-off" text="No devices reporting yet. Start the bridge to see status." />
      ) : (
        devices.map((d) => {
          const online = isDeviceOnline(d);
          return (
            <Card key={d.deviceId}>
              <View style={styles.devRow}>
                <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
                <View style={styles.grow}>
                  <Text style={styles.title}>{d.deviceName}</Text>
                  <Text style={styles.sub}>
                    Last seen {timeAgo(d.lastSeenAt)}
                    {d.queueDepth ? ` · ${d.queueDepth} queued offline` : ""}
                    {!online && d.lastError ? ` · ${d.lastError}` : ""}
                  </Text>
                </View>
                <Badge label={online ? "Online" : "Offline"} tone={online ? "in" : "critical"} />
              </View>
            </Card>
          );
        })
      )}

      <SectionTitle>Tamper &amp; Security Alarms</SectionTitle>
      {alarms.length === 0 ? (
        <EmptyState icon="shield-check-outline" text="No tamper or security alarms" />
      ) : (
        alarms.map((a) => (
          <Card key={a.id} style={{ opacity: a.acknowledged ? 0.55 : 1, borderLeftWidth: 3, borderLeftColor: a.severity === "critical" ? Colors.danger : Colors.warning }}>
            <View style={styles.devRow}>
              <MaterialCommunityIcons
                name={a.severity === "critical" ? "alert-octagon" : "alert"}
                size={26}
                color={a.severity === "critical" ? Colors.danger : Colors.warning}
              />
              <View style={styles.grow}>
                <Text style={[styles.sev, { color: a.severity === "critical" ? Colors.danger : Colors.warningDeep }]}>
                  {a.severity}{a.acknowledged ? " · acknowledged" : ""}
                </Text>
                <Text style={styles.title}>{a.message || a.type}</Text>
                <Text style={styles.sub}>{a.deviceName || a.deviceId} · {timeAgo(a.at)}</Text>
              </View>
              {!a.acknowledged && (
                <Pressable style={styles.ackBtn} disabled={busy === a.id} onPress={() => ack(a.id)}>
                  <Text style={styles.ackText}>{busy === a.id ? "…" : "Acknowledge"}</Text>
                </Pressable>
              )}
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  devRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotOn: { backgroundColor: Colors.success },
  dotOff: { backgroundColor: Colors.danger },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: "700", fontSize: 15, color: Colors.textPrimary },
  sub: { color: Colors.textFaint, fontSize: 13 },
  sev: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  ackBtn: {
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  ackText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 13 },
});
