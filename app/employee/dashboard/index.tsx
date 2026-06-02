import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Network from "expo-network";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import {
  createCheckInRecord,
  createCheckOutRecord,
  getTodayAttendance,
  syncPendingOperations,
} from "@/lib/attendance";

export default function Dashboard() {
  const router = useRouter();
  const inset = useResponsiveInset(22);
  const { width } = useWindowDimensions();
  const { employee, selectedBranch, latestLocation, setLatestLocation } = useSession();

  // Hero elements scale with the usable content width so they look right on
  // everything from small phones to tablets / web.
  const contentWidth = width - inset * 2;
  const circleSize = Math.max(168, Math.min(248, contentWidth * 0.62));
  const innerSize = circleSize - 32;
  const clockFontSize = Math.max(42, Math.min(62, contentWidth * 0.165));

  const [currentTime, setCurrentTime] = useState(new Date());
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [checkInAt, setCheckInAt] = useState<Date | null>(null);
  const [checkOutAt, setCheckOutAt] = useState<Date | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [breakStartAt, setBreakStartAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    if (!employee) {
      router.replace("/login");
    }
  }, [employee, router]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    const trySyncNow = async () => {
      const state = await Network.getNetworkStateAsync();
      if (!state.isConnected) return;
      const result = await syncPendingOperations();
      if (mounted && result.synced) {
        setSyncMessage("Pending offline records synced.");
      }
    };

    trySyncNow().catch(() => null);

    const subscription = Network.addNetworkStateListener((state) => {
      if (!state.isConnected) return;
      syncPendingOperations()
        .then((result) => {
          if (mounted && result.synced) {
            setSyncMessage("Pending offline records synced.");
          }
        })
        .catch(() => null);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const hydrateTodayState = async () => {
      if (!employee) return;
      try {
        const records = await getTodayAttendance(employee.employeeId);
        if (!mounted || records.length === 0) return;

        const latest = records[0];
        setCheckInAt(latest.checkInAt);
        setCheckOutAt(latest.checkOutAt);
        setIsCheckedIn(!latest.checkOutAt);
      } catch (error) {
        console.error(error);
      }
    };

    hydrateTodayState();

    return () => {
      mounted = false;
    };
  }, [employee]);

  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;

    const watchLocation = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return;

      watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 10,
          timeInterval: 10000,
        },
        (position) => {
          setLatestLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          });
        },
      );
    };

    watchLocation().catch((error) => console.error(error));

    return () => {
      if (watcher) watcher.remove();
    };
  }, [setLatestLocation]);

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

  const totalHoursLabel = useMemo(() => {
    if (!checkInAt || !checkOutAt) return "--:--";
    const diffMs = checkOutAt.getTime() - checkInAt.getTime();
    if (diffMs <= 0) return "--:--";
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

  const breakSecondsLeft = useMemo(() => {
    if (!isOnBreak || !breakStartAt) return 3600;
    const elapsed = Math.floor((currentTime.getTime() - breakStartAt.getTime()) / 1000);
    return Math.max(0, 3600 - elapsed);
  }, [isOnBreak, breakStartAt, currentTime]);

  const breakTimerLabel = useMemo(() => {
    const h = Math.floor(breakSecondsLeft / 3600);
    const m = Math.floor((breakSecondsLeft % 3600) / 60);
    const s = breakSecondsLeft % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [breakSecondsLeft]);

  const formatPunchTime = (value: Date | null) => {
    if (!value) return "--:--";
    return value.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const onCirclePress = async () => {
    if (isSyncing || !employee) return;

    if (isOnBreak) {
      setIsOnBreak(false);
      setBreakStartAt(null);
      return;
    }

    const activeBranch = selectedBranch
      ? selectedBranch
      : employee.branchId && employee.branchName
        ? {
            id: employee.branchId,
            name: employee.branchName,
            address: employee.branchName,
            lat: 0,
            lng: 0,
          }
        : null;

    if (!activeBranch) {
      setSyncMessage("Please confirm your branch first.");
      router.replace("/select-branch");
      return;
    }

    try {
      setIsSyncing(true);
      setSyncMessage("");

      if (!isCheckedIn) {
        const created = await createCheckInRecord({
          employeeId: employee.employeeId,
          employeeName: employee.fullName,
          branch: activeBranch,
          location: latestLocation,
        });

        setCheckInAt(created.checkInAt);
        setCheckOutAt(null);
        setIsCheckedIn(true);
        setSyncMessage(
          created.synced
            ? "Time in synced to cloud."
            : "Offline mode: time in saved locally and queued.",
        );
      } else {
        const updated = await createCheckOutRecord({
          employeeId: employee.employeeId,
          location: latestLocation,
        });

        if (!updated) {
          setSyncMessage("No active time in found.");
          return;
        }

        setCheckInAt(updated.checkInAt);
        setCheckOutAt(updated.checkOutAt);
        setIsCheckedIn(false);
        setIsOnBreak(false);
        setBreakStartAt(null);
        setSyncMessage(
          updated.synced
            ? "Time out synced to cloud."
            : "Offline mode: time out saved locally and queued.",
        );
      }
    } catch (error) {
      console.error(error);
      setSyncMessage("Unable to sync attendance. Please check internet.");
    } finally {
      setIsSyncing(false);
    }
  };

  const onTakeBreak = () => {
    setBreakStartAt(new Date());
    setIsOnBreak(true);
  };

  const circleTheme = isOnBreak ? "break" : isCheckedIn ? "out" : "in";

  const statusLabel = isSyncing
    ? "Syncing Attendance"
    : isOnBreak
      ? "On Break"
      : isCheckedIn
        ? "On the Line"
        : "Ready for Service";

  const statusDotColor = isSyncing
    ? "#3B82F6"
    : isOnBreak
      ? "#F59E0B"
      : isCheckedIn
        ? "#16A34A"
        : "#8FA89A";

  const employeeName = employee?.fullName ?? "Alfred Cabato";
  const initials = employeeName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const branchLabel = selectedBranch?.name ?? employee?.branchName ?? "Branch not set";
  const locationLabel = latestLocation
    ? `${latestLocation.lat.toFixed(5)}, ${latestLocation.lng.toFixed(5)}`
    : "Location waiting";

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
            {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
          </View>
          <Pressable style={styles.avatarWrap} onPress={() => router.replace("/employee/profile")}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.clockCard}>
          <View style={styles.clockHeader}>
            <View style={styles.clockHeaderLeft}>
              <Ionicons name="time-outline" size={13} color="#5A7264" />
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
          <Text style={styles.locationText}>Live GPS: {locationLabel}</Text>
        </View>

        <Pressable
          onPress={onCirclePress}
          disabled={isSyncing}
          style={[styles.checkAction, { borderRadius: circleSize / 2 }, isSyncing && styles.checkActionDisabled]}
          android_ripple={{ color: "rgba(0,0,0,0.05)", borderless: true }}
        >
          <View
            style={[
              styles.checkOuter,
              { width: circleSize, height: circleSize, borderRadius: circleSize / 2 },
              circleTheme === "out" && styles.checkOuterOut,
              circleTheme === "break" && styles.checkOuterBreak,
            ]}
          >
            <View
              style={[
                styles.checkInner,
                { width: innerSize, height: innerSize, borderRadius: innerSize / 2 },
                circleTheme === "out" && styles.checkInnerOut,
                circleTheme === "break" && styles.checkInnerBreak,
              ]}
            >
              {circleTheme === "break" ? (
                <>
                  <MaterialCommunityIcons name="coffee-outline" size={28} color="#92400E" />
                  <Text style={styles.breakLabel}>Break</Text>
                  <Text style={styles.breakTimer}>{breakTimerLabel}</Text>
                  <View style={styles.endBreakPill}>
                    <Text style={styles.endBreakText}>End Break</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={[styles.iconBubble, circleTheme === "out" && styles.iconBubbleOut]}>
                    <MaterialCommunityIcons
                      name={circleTheme === "out" ? "exit-to-app" : "chef-hat"}
                      size={26}
                      color="#ffffff"
                    />
                  </View>
                  <Text style={[styles.checkText, circleTheme === "out" && styles.checkTextOut]}>
                    {circleTheme === "out" ? "End Shift" : "Start Shift"}
                  </Text>
                  {circleTheme === "out" && liveDurationLabel && (
                    <Text style={styles.liveDuration}>{liveDurationLabel}</Text>
                  )}
                  {circleTheme === "in" && <Text style={styles.tapHint}>Tap to clock in</Text>}
                </>
              )}
            </View>
          </View>
        </Pressable>

        {isCheckedIn && !isOnBreak && (
          <Pressable
            onPress={onTakeBreak}
            style={styles.breakBtn}
            android_ripple={{ color: "rgba(0,0,0,0.05)" }}
          >
            <MaterialCommunityIcons name="coffee-outline" size={16} color="#92400E" />
            <Text style={styles.breakBtnText}>Take a Break</Text>
          </Pressable>
        )}

        <View style={styles.statsHeader}>
          <Text style={styles.statsHeaderText}>Today&apos;s Shift</Text>
        </View>
        <View style={styles.statsRow}>
          <MetricCard
            icon="login-variant"
            value={formatPunchTime(checkInAt)}
            label="Clock In"
            tint="#16A34A"
            bg="rgba(22, 163, 74, 0.08)"
          />
          <MetricCard
            icon="logout-variant"
            value={formatPunchTime(checkOutAt)}
            label="Clock Out"
            tint="#059669"
            bg="rgba(5, 150, 105, 0.08)"
          />
          <MetricCard
            icon="clock-outline"
            value={totalHoursLabel}
            label="Hours"
            tint="#1E3A2C"
            bg="rgba(30, 58, 44, 0.08)"
          />
        </View>
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
    backgroundColor: "#F2FBF6",
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
    color: "#5A7264",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  greeting: {
    fontSize: 30,
    fontWeight: "700",
    color: "#0B2A1E",
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
    color: "#5A7264",
    fontWeight: "500",
  },
  syncMessage: {
    marginTop: 6,
    color: "#44604F",
    fontSize: 12,
    fontWeight: "600",
  },
  avatarWrap: {
    width: 54,
    height: 54,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#0B2A1E",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#0B2A1E",
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
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
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
    color: "#5A7264",
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
    color: "#0B2A1E",
    lineHeight: 58,
  },
  clockSeconds: {
    fontSize: 22,
    color: "#059669",
    fontWeight: "600",
    marginBottom: 9,
    marginLeft: 2,
  },
  dateText: {
    marginTop: 4,
    fontSize: 13,
    color: "#5A7264",
    fontWeight: "500",
  },
  locationText: {
    marginTop: 8,
    fontSize: 12,
    color: "#8FA89A",
    fontWeight: "500",
  },
  branchTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(5, 150, 105, 0.08)",
    borderRadius: 10,
  },
  branchTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#059669",
  },
  branchTagText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#059669",
    letterSpacing: 0.2,
  },
  checkAction: {
    alignSelf: "center",
    borderRadius: 110,
    marginTop: 32,
  },
  checkActionDisabled: {
    opacity: 0.75,
  },
  checkOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(143, 168, 154, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  checkOuterOut: { backgroundColor: "rgba(5, 150, 105, 0.12)" },
  checkOuterBreak: { backgroundColor: "rgba(245, 158, 11, 0.15)" },
  checkInner: {
    width: 188,
    height: 188,
    borderRadius: 94,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  checkInnerOut: {
    backgroundColor: "#ffffff",
  },
  checkInnerBreak: {
    backgroundColor: "#FFFBEB",
  },
  iconBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#16A34A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  iconBubbleOut: {
    backgroundColor: "#059669",
    shadowColor: "#059669",
  },
  checkText: {
    fontSize: 20,
    color: "#0B2A1E",
    fontWeight: "700",
    letterSpacing: -0.4,
    marginTop: 4,
  },
  checkTextOut: { color: "#059669" },
  tapHint: {
    fontSize: 10,
    fontWeight: "600",
    color: "#8FA89A",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  liveDuration: {
    fontSize: 13,
    fontWeight: "700",
    color: "#059669",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  breakLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400E",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 4,
  },
  breakTimer: {
    fontSize: 20,
    fontWeight: "700",
    color: "#78350F",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  endBreakPill: {
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "#059669",
  },
  endBreakText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  breakBtn: {
    alignSelf: "center",
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  breakBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400E",
    letterSpacing: 0.2,
  },
  statsHeader: {
    marginTop: 32,
    marginBottom: 14,
  },
  statsHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5A7264",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    alignItems: "flex-start",
    backgroundColor: "#ffffff",
    padding: 14,
    borderRadius: 16,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
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
    color: "#0B2A1E",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  metricLabel: {
    marginTop: -6,
    fontSize: 10,
    color: "#8FA89A",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
