import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { Colors } from "@/constants/theme";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import {
  Schedule,
  Shift,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  emptySchedule,
  formatShift,
  fromYMDsafe,
  getSchedule,
  saveSchedule,
} from "@/lib/schedules";

function fmtOverrideDate(ymd: string) {
  const d = fromYMDsafe(ymd);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function SchedulesTab({ managerName }: { managerName: string }) {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sched, setSched] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // New-override inputs
  const [ovDate, setOvDate] = useState("");
  const [ovStart, setOvStart] = useState("09:00");
  const [ovEnd, setOvEnd] = useState("18:00");
  const [ovOff, setOvOff] = useState(false);

  useEffect(() => subscribeEmployees(setEmployees, () => setEmployees([])), []);

  const pickEmployee = async (emp: EmployeeSummary) => {
    setSelectedId(emp.employeeId);
    setMessage("");
    setLoading(true);
    try {
      const s = await getSchedule(emp.employeeId);
      // Stamp identity from the roster so a brand-new schedule saves with name/branch.
      setSched({ ...s, employeeName: emp.fullName, branchId: emp.branchId, branchName: emp.branchName });
    } catch {
      setSched(emptySchedule(emp.employeeId, emp.fullName));
    } finally {
      setLoading(false);
    }
  };

  const setWeekday = (day: number, patch: Partial<Shift>) => {
    setSched((prev) => {
      if (!prev) return prev;
      const weekly = prev.weekly.map((s, i) => (i === day ? { ...s, ...patch } : s));
      return { ...prev, weekly };
    });
  };

  const addOverride = () => {
    if (!sched) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ovDate)) {
      setMessage("Enter the override date as YYYY-MM-DD.");
      return;
    }
    setSched({
      ...sched,
      overrides: { ...sched.overrides, [ovDate]: { off: ovOff, start: ovStart, end: ovEnd } },
    });
    setOvDate("");
    setOvOff(false);
    setMessage("");
  };

  const removeOverride = (ymd: string) => {
    if (!sched) return;
    const next = { ...sched.overrides };
    delete next[ymd];
    setSched({ ...sched, overrides: next });
  };

  const save = async () => {
    if (!sched) return;
    try {
      setSaving(true);
      setMessage("");
      await saveSchedule(sched, managerName);
      setMessage("✓ Schedule saved.");
    } catch (e) {
      setMessage("Failed to save: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const overrideKeys = useMemo(
    () => (sched ? Object.keys(sched.overrides).sort() : []),
    [sched],
  );

  return (
    <View>
      <SectionTitle>Employee</SectionTitle>
      <Card>
        <View style={styles.chips}>
          {employees.length === 0 ? (
            <Text style={styles.muted}>Loading employees…</Text>
          ) : (
            employees.map((e) => {
              const active = e.employeeId === selectedId;
              return (
                <Pressable
                  key={e.employeeId}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => pickEmployee(e)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{e.fullName}</Text>
                  <Text style={[styles.chipId, active && styles.chipTextActive]}>{e.employeeId}</Text>
                </Pressable>
              );
            })
          )}
        </View>
      </Card>

      {loading && <Text style={styles.muted}>Loading schedule…</Text>}

      {sched && !loading && (
        <>
          <SectionTitle>Weekly Default</SectionTitle>
          <Card>
            {sched.weekly.map((shift, day) => (
              <View key={day} style={[styles.weekRow, day < 6 && styles.rowBorder]}>
                <Text style={styles.weekDay}>{WEEKDAY_SHORT[day]}</Text>
                <Text style={styles.weekDayFull}>{WEEKDAY_LABELS[day]}</Text>
                <TextInput
                  style={[styles.timeInput, shift.off && styles.disabled]}
                  value={shift.start}
                  editable={!shift.off}
                  onChangeText={(t) => setWeekday(day, { start: t })}
                  placeholder="09:00"
                  placeholderTextColor={Colors.textPlaceholder}
                />
                <Text style={styles.dash}>–</Text>
                <TextInput
                  style={[styles.timeInput, shift.off && styles.disabled]}
                  value={shift.end}
                  editable={!shift.off}
                  onChangeText={(t) => setWeekday(day, { end: t })}
                  placeholder="18:00"
                  placeholderTextColor={Colors.textPlaceholder}
                />
                <Pressable style={styles.restToggle} onPress={() => setWeekday(day, { off: !shift.off })}>
                  <View style={[styles.checkbox, shift.off && styles.checkboxOn]}>
                    {shift.off && <MaterialCommunityIcons name="check" size={12} color="#fff" />}
                  </View>
                  <Text style={styles.restLabel}>Rest</Text>
                </Pressable>
              </View>
            ))}
          </Card>

          <SectionTitle>Date Overrides</SectionTitle>
          <Card>
            {overrideKeys.length === 0 ? (
              <Text style={styles.muted}>No date overrides.</Text>
            ) : (
              overrideKeys.map((ymd) => (
                <View key={ymd} style={styles.ovRow}>
                  <Text style={styles.ovDate}>{fmtOverrideDate(ymd)}</Text>
                  <Text style={styles.ovShift}>{formatShift(sched.overrides[ymd])}</Text>
                  <Pressable style={styles.ovDel} onPress={() => removeOverride(ymd)}>
                    <MaterialCommunityIcons name="close" size={16} color={Colors.danger} />
                  </Pressable>
                </View>
              ))
            )}
            <View style={styles.ovAdd}>
              <TextInput
                style={[styles.timeInput, styles.ovDateInput]}
                value={ovDate}
                onChangeText={setOvDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <TextInput
                style={[styles.timeInput, ovOff && styles.disabled]}
                value={ovStart}
                editable={!ovOff}
                onChangeText={setOvStart}
                placeholder="09:00"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <Text style={styles.dash}>–</Text>
              <TextInput
                style={[styles.timeInput, ovOff && styles.disabled]}
                value={ovEnd}
                editable={!ovOff}
                onChangeText={setOvEnd}
                placeholder="18:00"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <Pressable style={styles.restToggle} onPress={() => setOvOff((v) => !v)}>
                <View style={[styles.checkbox, ovOff && styles.checkboxOn]}>
                  {ovOff && <MaterialCommunityIcons name="check" size={12} color="#fff" />}
                </View>
                <Text style={styles.restLabel}>Rest</Text>
              </Pressable>
              <Pressable style={styles.addBtn} onPress={addOverride}>
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>
          </Card>

          <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} disabled={saving} onPress={save}>
            <Text style={styles.saveText}>{saving ? "Saving…" : "Save Schedule"}</Text>
          </Pressable>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>
      )}

      {!sched && !loading && employees.length > 0 && (
        <EmptyState icon="account-clock-outline" text="Pick an employee to set their schedule" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  chipTextActive: { color: "#fff" },
  chipId: { fontSize: 10, color: Colors.textFaint, marginTop: 1 },
  muted: { color: Colors.textFaint, fontSize: 13 },

  weekRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, flexWrap: "wrap" },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  weekDay: {
    width: 42,
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primary,
    backgroundColor: Colors.warmSurface,
    textAlign: "center",
    paddingVertical: 5,
    borderRadius: 8,
  },
  weekDayFull: { width: 92, fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  timeInput: {
    width: 92,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.warmSurface,
    paddingHorizontal: 10,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  disabled: { opacity: 0.4 },
  dash: { color: Colors.textFaint },
  restToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.textPlaceholder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  restLabel: { fontSize: 13, fontWeight: "600", color: Colors.textMuted },

  ovRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  ovDate: { width: 200, fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  ovShift: { flex: 1, fontSize: 14, color: Colors.textMuted },
  ovDel: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.dangerTint, alignItems: "center", justifyContent: "center" },
  ovAdd: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, flexWrap: "wrap" },
  ovDateInput: { width: 130 },
  addBtn: { height: 38, paddingHorizontal: 16, borderRadius: 9, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  saveBtn: { height: 50, borderRadius: 13, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center", marginTop: 6 },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  message: { marginTop: 12, textAlign: "center", color: Colors.textMuted, fontWeight: "600", fontSize: 13 },
});
