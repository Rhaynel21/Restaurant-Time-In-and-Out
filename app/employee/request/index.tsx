import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AttendanceRequest, RequestKind, fileAttendanceRequest, subscribeMyRequests } from "@/lib/attendance-requests";

const INK = "#141414";
const GREEN = "#2F6B4F";
const MUTED = "#6B6B6B";
const FAINT = "#A8A8A8";

function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EmployeeRequest() {
  const inset = useResponsiveInset(22);
  const { employee } = useSession();
  const [kind, setKind] = useState<RequestKind>("overtime");
  const [date, setDate] = useState(todayYMD());
  const [hours, setHours] = useState("");
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<AttendanceRequest[]>([]);

  useEffect(() => {
    if (!employee) return;
    return subscribeMyRequests(employee.employeeId, setMine, () => setMine([]));
  }, [employee]);

  if (!employee) return <Redirect href="/login" />;

  const submit = async () => {
    setMsg("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setMsg("Enter the date as YYYY-MM-DD.");
    if (kind === "overtime" && !(parseFloat(hours) > 0)) return setMsg("Enter overtime hours.");
    if (kind === "correction" && !inTime && !outTime) return setMsg("Enter the corrected time-in and/or out.");
    if (!reason.trim()) return setMsg("Add a short reason.");
    setBusy(true);
    try {
      await fileAttendanceRequest(employee, {
        kind,
        date,
        hours: kind === "overtime" ? parseFloat(hours) : null,
        correctIn: kind === "correction" ? inTime || null : null,
        correctOut: kind === "correction" ? outTime || null : null,
        reason,
      });
      setMsg("✓ Request filed — awaiting approval.");
      setHours("");
      setInTime("");
      setOutTime("");
      setReason("");
    } catch (e) {
      setMsg("Failed: " + (e instanceof Error ? e.message : "error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <AmbientTop height={300} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: inset }]} showsVerticalScrollIndicator={false}>
        <View style={styles.brandBar}>
          <BrandTitle size={28} />
        </View>
        <Text style={styles.title}>File a Request</Text>
        <Text style={styles.sub}>Overtime or a DTR correction</Text>

        <View style={styles.card}>
          <View style={styles.segRow}>
            {(["overtime", "correction"] as const).map((k) => (
              <Pressable key={k} style={[styles.seg, kind === k && styles.segOn]} onPress={() => setKind(k)}>
                <Text style={[styles.segText, kind === k && styles.segTextOn]}>{k === "overtime" ? "Overtime" : "DTR Correction"}</Text>
              </Pressable>
            ))}
          </View>

          <Label>Date</Label>
          <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={FAINT} />

          {kind === "overtime" ? (
            <>
              <Label>Overtime hours</Label>
              <TextInput style={styles.input} value={hours} onChangeText={setHours} keyboardType="numeric" placeholder="2" placeholderTextColor={FAINT} />
            </>
          ) : (
            <View style={styles.rowGap}>
              <View style={styles.half}>
                <Label>Correct time-in</Label>
                <TextInput style={styles.input} value={inTime} onChangeText={setInTime} placeholder="09:00" placeholderTextColor={FAINT} />
              </View>
              <View style={styles.half}>
                <Label>Correct time-out</Label>
                <TextInput style={styles.input} value={outTime} onChangeText={setOutTime} placeholder="18:00" placeholderTextColor={FAINT} />
              </View>
            </View>
          )}

          <Label>Reason</Label>
          <TextInput style={[styles.input, styles.multiline]} value={reason} onChangeText={setReason} multiline placeholder="Briefly explain…" placeholderTextColor={FAINT} />

          {msg ? <Text style={[styles.msg, msg.startsWith("✓") && styles.msgOk]}>{msg}</Text> : null}
          <Pressable style={[styles.submit, busy && styles.dim]} disabled={busy} onPress={submit}>
            <Text style={styles.submitText}>{busy ? "Filing…" : "Submit request"}</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>My Requests</Text>
        {mine.length === 0 ? (
          <Text style={styles.note}>No requests yet.</Text>
        ) : (
          mine.map((r) => (
            <View key={r.id} style={styles.reqCard}>
              <View style={styles.grow}>
                <Text style={styles.reqTitle}>
                  {r.kind === "overtime" ? `Overtime · ${r.hours ?? 0} h` : "DTR Correction"} · {r.date}
                </Text>
                {r.reason ? <Text style={styles.reqSub} numberOfLines={2}>{r.reason}</Text> : null}
              </View>
              <View style={[styles.pill, r.status === "approved" ? styles.pillOk : r.status === "rejected" ? styles.pillNo : styles.pillWait]}>
                <Text style={[styles.pillText, r.status === "approved" ? styles.pillTextOk : r.status === "rejected" ? styles.pillTextNo : styles.pillTextWait]}>
                  {r.status[0].toUpperCase() + r.status.slice(1)}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <BottomNav active="home" />
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F5F0" },
  scroll: { flex: 1 },
  content: { paddingTop: 56, paddingBottom: 130 },
  brandBar: { marginBottom: 18 },
  title: { fontSize: 28, fontWeight: "800", color: INK, letterSpacing: -0.6 },
  sub: { fontSize: 14, color: MUTED, marginTop: 2, fontWeight: "500" },

  card: { marginTop: 20, backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "rgba(10,10,10,0.04)" },
  segRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  seg: { flex: 1, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#F2EFE9", borderWidth: 1, borderColor: "#E3DED4" },
  segOn: { backgroundColor: INK, borderColor: INK },
  segText: { fontSize: 13, fontWeight: "700", color: MUTED },
  segTextOn: { color: "#fff" },

  label: { fontSize: 12, fontWeight: "700", color: "#2A2A2A", marginTop: 14, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: "#E3DED4", backgroundColor: "#F7F5F0", paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: INK },
  multiline: { minHeight: 72, textAlignVertical: "top" } as object,
  rowGap: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },

  msg: { marginTop: 14, fontSize: 13, fontWeight: "600", color: "#B23A3A" },
  msgOk: { color: GREEN },
  submit: { marginTop: 16, height: 50, borderRadius: 14, backgroundColor: GREEN, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  dim: { opacity: 0.6 },

  section: { fontSize: 12, fontWeight: "800", color: FAINT, textTransform: "uppercase", letterSpacing: 1.2, marginTop: 26, marginBottom: 10 },
  note: { color: MUTED, fontSize: 14 },
  reqCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "rgba(10,10,10,0.04)" },
  grow: { flex: 1, minWidth: 0 },
  reqTitle: { fontSize: 14, fontWeight: "700", color: INK },
  reqSub: { fontSize: 12, color: FAINT, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillWait: { backgroundColor: "#F7F2E8" },
  pillOk: { backgroundColor: "rgba(47,107,79,0.12)" },
  pillNo: { backgroundColor: "rgba(178,58,58,0.10)" },
  pillText: { fontSize: 11, fontWeight: "800" },
  pillTextWait: { color: "#6E5526" },
  pillTextOk: { color: GREEN },
  pillTextNo: { color: "#B23A3A" },
});
