import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AttendanceRecord, subscribeTodayAttendance } from "@/lib/attendance";
import { DeviceStatus, isDeviceOnline, subscribeDevices } from "@/lib/devices";
import { subscribeMyNotifications } from "@/lib/notifications";

export default function Dashboard() {
  const router = useRouter();
  const inset = useResponsiveInset(22);
  const { width } = useWindowDimensions();
  const { employee } = useSession();

  // Hero elements scale with the usable content width so they look right on
  // everything from small phones to tablets / web.
  const contentWidth = width - inset * 2;
  const circleSize = Math.max(168, Math.min(248, contentWidth * 0.62));
  const innerSize = circleSize - 32;
  const clockFontSize = Math.max(42, Math.min(62, contentWidth * 0.165));

  const [currentTime, setCurrentTime] = useState(new Date());
  const [checkInAt, setCheckInAt] = useState<Date | null>(null);
  const [checkOutAt, setCheckOutAt] = useState<Date | null>(null);
  const [breakOutAt, setBreakOutAt] = useState<Date | null>(null);
  const [breakInAt, setBreakInAt] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);

  const isCheckedIn = checkInAt !== null && checkOutAt === null;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time stream of today's punches. The Hikvision bridge writes biometric
  // scans into Firestore; this listener reflects them with no user action.
  useEffect(() => {
    if (!employee) return;

    const unsubscribe = subscribeTodayAttendance(
      employee.employeeId,
      (records: AttendanceRecord[]) => {
        setIsLive(true);
        const latest = records[0];
        if (!latest) {
          setCheckInAt(null);
          setCheckOutAt(null);
          setBreakOutAt(null);
          setBreakInAt(null);
          return;
        }
        setCheckInAt(latest.checkInAt);
        setCheckOutAt(latest.checkOutAt);
        setBreakOutAt(latest.breakOutAt);
        setBreakInAt(latest.breakInAt);
      },
      () => setIsLive(false),
    );

    return unsubscribe;
  }, [employee]);

  // Biometric terminal health, so we can tell the employee when their scans are
  // being buffered offline (rather than silently missing).
  useEffect(() => subscribeDevices(setDevices, () => setDevices([])), []);
  useEffect(() => {
    if (!employee) return;
    return subscribeMyNotifications(employee.employeeId, (n) => setNotifUnread(n.filter((x) => !x.read).length), () => setNotifUnread(0));
  }, [employee]);

  const timeLabel = currentTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const secondsLabel = currentTime
    .toLocaleTimeString("en-US", { second: "2-digit" })
    .replace(/\D/g, "")
    .padStart(2, "0");

  const dateLabel = `${currentTime.toLocaleDateString("en-US", {
    weekday: "long",
  })}, ${currentTime.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;

  const greetingWord =
    currentTime.getHours() < 12
      ? "Good morning"
      : currentTime.getHours() < 18
        ? "Good afternoon"
        : "Good evening";

  // Worked-hours = clock out − clock in. Only "--:--" until there's a checkout;
  // once clocked out we always show the computed total (HH:MM), even if short.
  const totalHoursLabel = useMemo(() => {
    if (!checkInAt || !checkOutAt) return "--:--";
    const diffMs = Math.max(0, checkOutAt.getTime() - checkInAt.getTime());
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }, [checkInAt, checkOutAt]);

  const liveDurationLabel = useMemo(() => {
    if (!isCheckedIn || !checkInAt) return null;
    const diffMs = currentTime.getTime() - checkInAt.getTime();
    if (diffMs <= 0) return "00:00:00";
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [isCheckedIn, checkInAt, currentTime]);

  const formatPunchTime = (value: Date | null) => {
    if (!value) return "--:--";
    return value.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Three display states: on shift, shift ended today, or no scan yet.
  const circleTheme: "in" | "out" | "idle" = isCheckedIn
    ? "in"
    : checkOutAt
      ? "out"
      : "idle";

  const statusLabel = isCheckedIn
    ? "On the Line"
    : checkOutAt
      ? "Shift Complete"
      : "Awaiting Scan";

  const statusDotColor = isCheckedIn ? "#2F6B4F" : checkOutAt ? "#0A0A0A" : "#A8A8A8";

  const employeeName = employee?.fullName ?? "Alfred Cabato";
  const initials = employeeName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const branchLabel = employee?.branchName ?? "Branch not set";

  const circleTitle =
    circleTheme === "in" ? "Clocked In" : circleTheme === "out" ? "Clocked Out" : "No Scan Yet";
  const circleIcon =
    circleTheme === "in" ? "chef-hat" : circleTheme === "out" ? "exit-to-app" : "fingerprint";

  // Sync-health banner: buffered scans take priority (recovery in progress),
  // otherwise flag a stale/offline scanner. Silent when everything is healthy.
  const queuedScans = devices.reduce((sum, d) => sum + (d.queueDepth || 0), 0);
  const scannerOffline = devices.length > 0 && devices.some((d) => !isDeviceOnline(d));
  const syncBanner: { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; text: string } | null =
    queuedScans > 0
      ? {
          icon: "cloud-sync-outline",
          text: `Syncing ${queuedScans} buffered scan${queuedScans === 1 ? "" : "s"}… they'll appear here shortly.`,
        }
      : scannerOffline
        ? {
            icon: "cloud-off-outline",
            text: "Scanner offline — your scans are still saved and will sync automatically once it reconnects.",
          }
        : null;

  // No session → bounce to login. Declarative <Redirect> waits for the navigator
  // to be ready (an imperative router.replace in an effect can fire too early and
  // throw "navigate before mounting the Root Layout").
  if (!employee) return <Redirect href="/login" />;

  return (
    <View style={styles.screen}>
      <AmbientTop height={360} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: inset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBar}>
          <BrandTitle size={28} />
        </View>

        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.eyebrow}>{greetingWord}, Chef</Text>
            <Text style={styles.greeting}>{employeeName}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
              <Text style={styles.statusLabel}>{statusLabel}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Pressable
              style={styles.bellBtn}
              onPress={() => router.push("/employee/notifications" as never)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={20} color="#0A0A0A" />
              {notifUnread > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{notifUnread > 9 ? "9+" : notifUnread}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </View>
        </View>

        <View style={styles.clockCard}>
          <View style={styles.clockHeader}>
            <View style={styles.clockHeaderLeft}>
              <Ionicons name="time-outline" size={13} color="#8A8A8A" />
              <Text style={styles.clockHeaderText}>Current time</Text>
            </View>
            <View style={styles.branchTag}>
              <View style={styles.branchTagDot} />
              <Text style={styles.branchTagText}>{branchLabel}</Text>
            </View>
          </View>
          <View style={styles.clockRow}>
            <Text style={[styles.clockText, { fontSize: clockFontSize, lineHeight: clockFontSize * 1.12 }]}>{timeLabel}</Text>
            <Text style={styles.clockSeconds}>:{secondsLabel}</Text>
          </View>
          <Text style={styles.dateText}>{dateLabel}</Text>
        </View>

        {/* Read-only status dial — biometric device is the source of truth. */}
        <View style={[styles.checkAction, { borderRadius: circleSize / 2 }]}>
          <View
            style={[
              styles.checkOuter,
              { width: circleSize, height: circleSize, borderRadius: circleSize / 2 },
              circleTheme === "out" && styles.checkOuterOut,
              circleTheme === "idle" && styles.checkOuterIdle,
            ]}
          >
            <View
              style={[
                styles.checkInner,
                { width: innerSize, height: innerSize, borderRadius: innerSize / 2 },
              ]}
            >
              <View
                style={[
                  styles.iconBubble,
                  circleTheme === "out" && styles.iconBubbleOut,
                  circleTheme === "idle" && styles.iconBubbleIdle,
                ]}
              >
                <MaterialCommunityIcons name={circleIcon} size={26} color="#ffffff" />
              </View>
              <Text style={[styles.checkText, circleTheme === "out" && styles.checkTextOut]}>
                {circleTitle}
              </Text>
              {circleTheme === "in" && liveDurationLabel && (
                <Text style={styles.liveDuration}>{liveDurationLabel}</Text>
              )}
              {circleTheme === "idle" && <Text style={styles.tapHint}>Scan at the device</Text>}
            </View>
          </View>
        </View>

        {syncBanner && (
          <View style={styles.syncBanner}>
            <MaterialCommunityIcons name={syncBanner.icon} size={16} color="#8A5A2B" />
            <Text style={styles.syncBannerText}>{syncBanner.text}</Text>
          </View>
        )}

        <View style={styles.bioHint}>
          <MaterialCommunityIcons name="fingerprint" size={15} color="#0A0A0A" />
          <Text style={styles.bioHintText}>
            {isLive
              ? "Time in & out are recorded automatically at the biometric scanner."
              : "Connecting to live attendance…"}
          </Text>
        </View>

        <View style={styles.statsHeader}>
          <Text style={styles.statsHeaderText}>Today&apos;s Shift</Text>
        </View>
        <View style={styles.statsRow}>
          <MetricCard
            icon="login-variant"
            value={formatPunchTime(checkInAt)}
            label="Clock In"
            tint="#2F6B4F"
            bg="rgba(47, 107, 79, 0.08)"
          />
          <MetricCard
            icon="logout-variant"
            value={formatPunchTime(checkOutAt)}
            label="Clock Out"
            tint="#0A0A0A"
            bg="rgba(10, 10, 10, 0.05)"
          />
          <MetricCard
            icon="clock-outline"
            value={totalHoursLabel}
            label="Hours"
            tint="#2A2A2A"
            bg="rgba(20, 20, 20, 0.08)"
          />
        </View>
        <View style={[styles.statsRow, styles.statsRowSecond]}>
          <MetricCard
            icon="coffee-outline"
            value={formatPunchTime(breakOutAt)}
            label="Break Out"
            tint="#8A5A2B"
            bg="rgba(138, 90, 43, 0.10)"
          />
          <MetricCard
            icon="coffee-off-outline"
            value={formatPunchTime(breakInAt)}
            label="Break In"
            tint="#2F6B4F"
            bg="rgba(47, 107, 79, 0.08)"
          />
        </View>

        <Pressable style={styles.scheduleLink} onPress={() => router.push("/employee/checkin" as never)}>
          <View style={styles.scheduleLinkIcon}>
            <MaterialCommunityIcons name="map-marker-check-outline" size={20} color="#0A0A0A" />
          </View>
          <View style={styles.scheduleLinkText}>
            <Text style={styles.scheduleLinkTitle}>GPS Check-in</Text>
            <Text style={styles.scheduleLinkSub}>Clock in from your phone when away from the scanner</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#A8A8A8" />
        </Pressable>

        <Pressable style={styles.scheduleLink} onPress={() => router.push("/employee/schedule" as never)}>
          <View style={styles.scheduleLinkIcon}>
            <MaterialCommunityIcons name="calendar-clock" size={20} color="#0A0A0A" />
          </View>
          <View style={styles.scheduleLinkText}>
            <Text style={styles.scheduleLinkTitle}>My Schedule</Text>
            <Text style={styles.scheduleLinkSub}>View your shifts for the week</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#A8A8A8" />
        </Pressable>

        <Pressable style={styles.scheduleLink} onPress={() => router.push("/employee/request" as never)}>
          <View style={styles.scheduleLinkIcon}>
            <MaterialCommunityIcons name="clock-edit-outline" size={20} color="#0A0A0A" />
          </View>
          <View style={styles.scheduleLinkText}>
            <Text style={styles.scheduleLinkTitle}>File a Request</Text>
            <Text style={styles.scheduleLinkSub}>Overtime or DTR correction</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#A8A8A8" />
        </Pressable>
      </ScrollView>

      <BottomNav active="home" />
    </View>
  );
}

function MetricCard({
  icon,
  value,
  label,
  tint,
  bg,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  value: string;
  label: string;
  tint: string;
  bg: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIconWrap, { backgroundColor: bg }]}>
        <MaterialCommunityIcons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F5F0",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 56,
    paddingBottom: 130,
  },
  brandBar: {
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8A8A8A",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  greeting: {
    fontSize: 30,
    fontWeight: "700",
    color: "#141414",
    letterSpacing: -0.8,
    marginTop: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 13,
    color: "#8A8A8A",
    fontWeight: "500",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.05)",
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  bellBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: "#B23A3A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  bellBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#141414",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarText: {
    fontSize: 16,
    color: "#ffffff",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  clockCard: {
    marginTop: 24,
    padding: 20,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
  clockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  clockHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  clockHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8A8A8A",
    letterSpacing: 0.3,
  },
  clockRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 14,
  },
  clockText: {
    fontSize: 52,
    letterSpacing: -2,
    fontWeight: "300",
    color: "#141414",
    lineHeight: 58,
  },
  clockSeconds: {
    fontSize: 22,
    color: "#0A0A0A",
    fontWeight: "600",
    marginBottom: 9,
    marginLeft: 2,
  },
  dateText: {
    marginTop: 4,
    fontSize: 13,
    color: "#8A8A8A",
    fontWeight: "500",
  },
  branchTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(10, 10, 10, 0.05)",
    borderRadius: 10,
  },
  branchTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0A0A0A",
  },
  branchTagText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0A0A0A",
    letterSpacing: 0.2,
  },
  checkAction: {
    alignSelf: "center",
    marginTop: 32,
  },
  checkOuter: {
    backgroundColor: "rgba(47, 107, 79, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  checkOuterOut: { backgroundColor: "rgba(10, 10, 10, 0.10)" },
  checkOuterIdle: { backgroundColor: "rgba(168, 168, 168, 0.15)" },
  checkInner: {
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
  iconBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#2F6B4F",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2F6B4F",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  iconBubbleOut: {
    backgroundColor: "#0A0A0A",
    shadowColor: "#0A0A0A",
  },
  iconBubbleIdle: {
    backgroundColor: "#A8A8A8",
    shadowColor: "#A8A8A8",
  },
  checkText: {
    fontSize: 20,
    color: "#141414",
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: 4,
  },
  checkTextOut: { color: "#0A0A0A" },
  tapHint: {
    fontSize: 10,
    fontWeight: "600",
    color: "#A8A8A8",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  liveDuration: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2F6B4F",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  bioHint: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(10, 10, 10, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.10)",
  },
  syncBanner: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: "rgba(138, 90, 43, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(138, 90, 43, 0.22)",
  },
  syncBannerText: {
    flex: 1,
    fontSize: 12,
    color: "#7A4F26",
    fontWeight: "600",
    lineHeight: 16,
  },
  bioHintText: {
    flex: 1,
    fontSize: 12,
    color: "#6B6B6B",
    fontWeight: "500",
    lineHeight: 17,
  },
  statsHeader: {
    marginTop: 32,
    marginBottom: 14,
  },
  statsHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8A8A8A",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  statsRowSecond: {
    marginTop: 10,
  },
  scheduleLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
  scheduleLinkIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(10, 10, 10, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleLinkText: { flex: 1 },
  notifBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: "#B23A3A", alignItems: "center", justifyContent: "center", marginRight: 8 },
  notifBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  scheduleLinkTitle: { fontSize: 15, fontWeight: "700", color: "#141414" },
  scheduleLinkSub: { fontSize: 12, color: "#A8A8A8", fontWeight: "500", marginTop: 2 },
  metricCard: {
    flex: 1,
    alignItems: "flex-start",
    backgroundColor: "#ffffff",
    padding: 14,
    borderRadius: 16,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
    gap: 10,
  },
  metricIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#141414",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  metricLabel: {
    marginTop: -6,
    fontSize: 10,
    color: "#A8A8A8",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
