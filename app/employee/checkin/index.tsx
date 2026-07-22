import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Redirect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AttendanceRecord, gpsCheckIn, gpsCheckOut, subscribeTodayAttendance } from "@/lib/attendance";
import { LocationPoint } from "@/lib/branches";
import { checkGeofence, GeofenceCheck } from "@/lib/geofence";
import { Branch, getOrgBranch } from "@/lib/org";
import { flushQueuedGpsCheckIns, flushQueuedGpsCheckOuts, queueGpsCheckIn, queueGpsCheckOut } from "@/lib/gps-punch-queue";

// Mobile GPS check-in (Step 3 of the Klicc flow) — an alternative to the biometric
// terminal. Reads the device location, checks it against the employee's branch
// geofence and writes a method:"gps" punch. Selfie and face-recognition capture
// are intentionally outside the current implementation scope.

export default function GpsCheckIn() {
  const router = useRouter();
  const inset = useResponsiveInset(22);
  const { employee } = useSession();

  const [loc, setLoc] = useState<LocationPoint | null>(null);
  const [locState, setLocState] = useState<"idle" | "loading" | "denied" | "error" | "ready">("idle");
  const [openRecord, setOpenRecord] = useState<AttendanceRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [branch, setBranch] = useState<Branch | null>(null);

  // The employee's branch geofence (coords from the branch registry; radius uses
  // the geofence default when a branch hasn't set one).
  const fence: GeofenceCheck | null = loc && branch ? checkGeofence(loc, branch) : null;

  useEffect(() => {
    if (!employee?.branchId) return setBranch(null);
    getOrgBranch(employee.branchId).then(setBranch).catch(() => setBranch(null));
  }, [employee?.branchId]);

  // Track today's open punch so we know whether to offer check-in or check-out.
  useEffect(() => {
    if (!employee) return;
    return subscribeTodayAttendance(
      employee.employeeId,
      (records) => setOpenRecord(records.find((r) => !r.checkOutAt) ?? null),
      () => setOpenRecord(null),
    );
  }, [employee]);

  const locate = useCallback(async () => {
    setLocState("loading");
    setMessage("");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocState("denied");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyMeters: pos.coords.accuracy ?? null });
      setLocState("ready");
    } catch {
      setLocState("error");
    }
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  useEffect(() => {
    Promise.all([flushQueuedGpsCheckIns(), flushQueuedGpsCheckOuts()]).then(([ins, outs]) => {
      const count = ins + outs;
      if (count) setMessage(`Synced ${count} offline punch${count === 1 ? "" : "es"}.`);
    }).catch(() => null);
  }, []);

  const punch = async () => {
    if (!employee || !loc) return;
    setBusy(true);
    setMessage("");
    try {
      if (openRecord) {
        try {
          await gpsCheckOut(openRecord.id, openRecord.checkInAt, loc);
          setMessage("✓ Clocked out. Have a good rest!");
        } catch {
          await queueGpsCheckOut(openRecord.id, openRecord.checkInAt, loc);
          setMessage("✓ Clock-out saved offline. It will sync automatically.");
        }
      } else {
        if (fence && !fence.ok && fence.reason === "outside") {
          setMessage("You're outside the branch area — move closer to clock in.");
          setBusy(false);
          return;
        }
        try {
          await gpsCheckIn(employee, loc);
          setMessage("✓ Clocked in. Welcome to the line!");
        } catch {
          await queueGpsCheckIn(employee, loc);
          setMessage("✓ Punch saved offline. It will sync automatically.");
        }
      }
    } catch (e) {
      setMessage("Punch failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  };

  if (!employee) return <Redirect href="/login" />;

  const isCheckOut = !!openRecord;
  const canPunch = locState === "ready" && (isCheckOut || !fence || fence.ok || fence.reason === "no-geofence");

  return (
    <View style={styles.screen}>
      <AmbientTop height={300} />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: inset }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#0A0A0A" />
          </Pressable>
          <BrandTitle size={24} />
          <View style={{ width: 40 }} />
        </View>

        <Text style={styles.title}>GPS Check-in</Text>
        <Text style={styles.subtitle}>{branch ? branch.name : "No branch assigned"}</Text>

        {/* Geofence status card */}
        <View style={styles.card}>
          <View style={styles.locHead}>
            <MaterialCommunityIcons name="map-marker-radius" size={20} color="#2F6B4F" />
            <Text style={styles.locHeadText}>Location</Text>
            <Pressable style={styles.refreshBtn} onPress={locate} hitSlop={8}>
              <MaterialCommunityIcons name="refresh" size={16} color="#8A8A8A" />
            </Pressable>
          </View>

          {locState === "loading" && (
            <View style={styles.locRow}>
              <ActivityIndicator size="small" color="#2F6B4F" />
              <Text style={styles.locMuted}>Getting your location…</Text>
            </View>
          )}
          {locState === "denied" && <Text style={styles.locDenied}>Location permission denied. Enable it to check in by GPS.</Text>}
          {locState === "error" && <Text style={styles.locDenied}>Couldn&apos;t get your location. Tap refresh to retry.</Text>}

          {locState === "ready" && fence && (
            <View style={styles.fenceBox}>
              <View style={[styles.fenceBadge, fence.ok ? styles.fenceOk : fence.reason === "no-geofence" ? styles.fenceUnknown : styles.fenceOut]}>
                <MaterialCommunityIcons
                  name={fence.ok ? "check-circle" : fence.reason === "no-geofence" ? "help-circle-outline" : "alert-circle"}
                  size={16}
                  color="#fff"
                />
                <Text style={styles.fenceBadgeText}>
                  {fence.reason === "no-geofence" ? "No geofence set" : fence.ok ? "Inside branch area" : "Outside branch area"}
                </Text>
              </View>
              {fence.distanceMeters != null && (
                <Text style={styles.fenceDist}>
                  {fence.distanceMeters} m from branch{fence.radiusMeters ? ` · ${fence.radiusMeters} m allowed` : ""}
                </Text>
              )}
            </View>
          )}
          {locState === "ready" && !branch && <Text style={styles.locDenied}>No branch is assigned to your profile — ask HR to set one.</Text>}
        </View>

        {/* Punch button */}
        <Pressable
          style={[styles.punchBtn, isCheckOut ? styles.punchOut : styles.punchIn, (!canPunch || busy) && styles.punchDisabled]}
          onPress={punch}
          disabled={!canPunch || busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons name={isCheckOut ? "logout-variant" : "login-variant"} size={22} color="#fff" />
              <Text style={styles.punchText}>{isCheckOut ? "Clock Out" : "Clock In"}</Text>
            </>
          )}
        </Pressable>
        {isCheckOut && openRecord && (
          <Text style={styles.sinceText}>
            On shift since {openRecord.checkInAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
          </Text>
        )}

        {message ? (
          <View style={styles.msgBox}>
            <Text style={styles.msgText}>{message}</Text>
          </View>
        ) : null}

        <View style={styles.note}>
          <MaterialCommunityIcons name="information-outline" size={15} color="#8A8A8A" />
          <Text style={styles.noteText}>
            GPS check-in is an alternative to the biometric scanner. Your location is recorded with the punch for verification.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F5F0" },
  content: { paddingTop: 56, paddingBottom: 60 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(10,10,10,0.05)" },
  title: { fontSize: 28, fontWeight: "700", color: "#141414", letterSpacing: -0.6 },
  subtitle: { fontSize: 14, color: "#8A8A8A", fontWeight: "500", marginTop: 4, marginBottom: 24 },

  card: { backgroundColor: "#fff", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "rgba(10,10,10,0.04)", shadowColor: "#141414", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 14, elevation: 3 },
  locHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  locHeadText: { flex: 1, fontSize: 13, fontWeight: "700", color: "#141414", textTransform: "uppercase", letterSpacing: 0.6 },
  refreshBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(10,10,10,0.05)", alignItems: "center", justifyContent: "center" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  locMuted: { fontSize: 14, color: "#8A8A8A", fontWeight: "500" },
  locDenied: { fontSize: 13, color: "#B23A3A", fontWeight: "600", marginTop: 14, lineHeight: 18 },

  fenceBox: { marginTop: 16, gap: 8 },
  fenceBadge: { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  fenceOk: { backgroundColor: "#2F6B4F" },
  fenceOut: { backgroundColor: "#B23A3A" },
  fenceUnknown: { backgroundColor: "#A8A8A8" },
  fenceBadgeText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  fenceDist: { fontSize: 12.5, color: "#8A8A8A", fontWeight: "600", fontVariant: ["tabular-nums"] },

  punchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 60, borderRadius: 18, marginTop: 24 },
  punchIn: { backgroundColor: "#2F6B4F" },
  punchOut: { backgroundColor: "#0A0A0A" },
  punchDisabled: { opacity: 0.4 },
  punchText: { color: "#fff", fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  sinceText: { textAlign: "center", fontSize: 13, color: "#8A8A8A", fontWeight: "600", marginTop: 12 },

  msgBox: { marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: "rgba(47,107,79,0.08)", borderWidth: 1, borderColor: "rgba(47,107,79,0.20)" },
  msgText: { fontSize: 14, color: "#2F6B4F", fontWeight: "600", textAlign: "center" },

  note: { flexDirection: "row", gap: 8, marginTop: 24, paddingHorizontal: 4 },
  noteText: { flex: 1, fontSize: 12, color: "#8A8A8A", fontWeight: "500", lineHeight: 17 },
});
