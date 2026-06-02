import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AttendanceRecord, getRecentAttendance } from "@/lib/attendance";

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function isLate(date: Date) {
  return date.getHours() * 60 + date.getMinutes() > 9 * 60 + 35;
}

type DayStatus = "present" | "late" | "absent";

function statusColor(status: DayStatus) {
  if (status === "present") return "#16A34A";
  if (status === "late") return "#CA8A04";
  return "#DC2626";
}

function formatTime(value: Date) {
  return value.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const inset = useResponsiveInset(18);
  const { employee } = useSession();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadHistory = async () => {
    if (!employee) return;
    try {
      setIsLoading(true);
      setErrorMessage("");
      const data = await getRecentAttendance(employee.employeeId, 60);
      setRecords(data);
    } catch (error) {
      console.error(error);
      setErrorMessage("Unable to load attendance history.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [employee]);

  // Build per-day status map for the displayed month
  const dayStatusMap = useMemo(() => {
    const map = new Map<number, DayStatus>();
    records.forEach((r) => {
      if (r.checkInAt.getFullYear() === year && r.checkInAt.getMonth() === month) {
        const day = r.checkInAt.getDate();
        const status = isLate(r.checkInAt) ? "late" : "present";
        // If already marked present, keep it; otherwise overwrite with late
        if (!map.has(day) || status === "late") map.set(day, status);
      }
    });
    return map;
  }, [records, year, month]);

  // Start of today, and the day of the employee's first-ever record. Days that
  // fall between (first record … yesterday) with no attendance are "absent".
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const earliestRecordStart = useMemo(() => {
    if (records.length === 0) return null;
    return records.reduce((min, r) => {
      const t = new Date(
        r.checkInAt.getFullYear(),
        r.checkInAt.getMonth(),
        r.checkInAt.getDate(),
      ).getTime();
      return t < min ? t : min;
    }, Infinity);
  }, [records]);

  const getDayStatus = (day: number): DayStatus | undefined => {
    const recorded = dayStatusMap.get(day);
    if (recorded) return recorded;
    if (earliestRecordStart === null) return undefined;
    const cellTime = new Date(year, month, day).getTime();
    // Today and future days are never absent; neither are days before the
    // employee's first record (i.e. before they started using the app).
    if (cellTime >= todayStart || cellTime < earliestRecordStart) return undefined;
    return "absent";
  };

  const totalDays = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const calendarCells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  const goPrev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };

  const goNext = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };

  const filteredRecords = useMemo(() => {
    if (selectedDate !== null) {
      return records.filter(
        (r) =>
          r.checkInAt.getFullYear() === year &&
          r.checkInAt.getMonth() === month &&
          r.checkInAt.getDate() === selectedDate,
      );
    }
    return records;
  }, [selectedDate, records, year, month]);

  const summary = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    for (let day = 1; day <= totalDays; day++) {
      const recorded = dayStatusMap.get(day);
      if (recorded === "present") {
        present += 1;
        continue;
      }
      if (recorded === "late") {
        late += 1;
        continue;
      }
      if (earliestRecordStart === null) continue;
      const cellTime = new Date(year, month, day).getTime();
      if (cellTime >= todayStart || cellTime < earliestRecordStart) continue;
      absent += 1;
    }
    return { present, late, absent };
  }, [dayStatusMap, totalDays, earliestRecordStart, todayStart, year, month]);

  return (
    <View style={styles.screen}>
      <AmbientTop height={220} />

      <View style={[styles.header, { paddingHorizontal: inset }]}>
        <BrandTitle size={28} />
        <Pressable style={styles.iconBtn} onPress={loadHistory}>
          <Ionicons name="refresh" size={18} color="#0B2A1E" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: inset }]}
      >
        {/* ── Summary chips ── */}
        <View style={styles.summaryRow}>
          <SummaryChip label="Present" value={summary.present} color="#16A34A" />
          <SummaryChip label="Late" value={summary.late} color="#CA8A04" />
          <SummaryChip label="Absent" value={summary.absent} color="#DC2626" />
        </View>

        {/* ── Month navigation ── */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={goPrev} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={18} color="#0B2A1E" />
            <Text style={styles.navLabel}>Prev</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity onPress={goNext} style={styles.navBtn}>
            <Text style={styles.navLabel}>Next</Text>
            <Ionicons name="chevron-forward" size={18} color="#0B2A1E" />
          </TouchableOpacity>
        </View>

        {/* ── Calendar ── */}
        <View style={styles.calendarCard}>
          <View style={styles.calRow}>
            {DAY_LABELS.map(d => (
              <Text key={d} style={styles.dayHeader}>{d}</Text>
            ))}
          </View>

          <View style={styles.calGrid}>
            {calendarCells.map((cell, idx) => {
              if (cell === null) return <View key={`empty-${idx}`} style={styles.calCell} />;

              const status = getDayStatus(cell);
              const isSelected = cell === selectedDate;
              const bgColor = isSelected && status ? statusColor(status) : undefined;

              return (
                <TouchableOpacity
                  key={cell}
                  style={[
                    styles.calCell,
                    isSelected && styles.calCellSelected,
                    isSelected && status && { backgroundColor: bgColor },
                    isSelected && !status && styles.calCellSelectedEmpty,
                  ]}
                  onPress={() => setSelectedDate(prev => prev === cell ? null : cell)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.calDate, isSelected && styles.calDateSelected]}>
                    {cell}
                  </Text>
                  {status && !isSelected && (
                    <View style={[styles.dot, { backgroundColor: statusColor(status) }]} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.legend}>
            <LegendItem color="#16A34A" label="Present" />
            <LegendItem color="#CA8A04" label="Late" />
            <LegendItem color="#DC2626" label="Absent" />
          </View>
        </View>

        {/* ── Records list ── */}
        <Text style={styles.sectionLabel}>
          {selectedDate !== null
            ? `${MONTHS[month]} ${selectedDate}, ${year}`
            : "Recent Records"}
        </Text>

        {isLoading ? <Text style={styles.messageText}>Loading attendance...</Text> : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        {filteredRecords.length === 0 && !isLoading ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-remove-outline" size={48} color="#B0C8B8" />
            <Text style={styles.emptyText}>No attendance records yet</Text>
          </View>
        ) : (
          filteredRecords.map((record) => <AttendanceCard key={record.id} record={record} />)
        )}
      </ScrollView>

      <BottomNav active="history" />
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryChip}>
      <View style={[styles.summaryDot, { backgroundColor: color }]} />
      <View>
        <Text style={styles.summaryValue}>{value}</Text>
        <Text style={styles.summaryLabel}>{label}</Text>
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function AttendanceCard({ record }: { record: AttendanceRecord }) {
  const checkInText = formatTime(record.checkInAt);
  const checkOutText = record.checkOutAt ? formatTime(record.checkOutAt) : "--:--";
  const totalText =
    typeof record.totalMinutes === "number"
      ? `${String(Math.floor(record.totalMinutes / 60)).padStart(2, "0")}:${String(record.totalMinutes % 60).padStart(2, "0")}`
      : "--:--";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.dateBadge}>
          <Text style={styles.badgeDate}>{record.checkInAt.getDate()}</Text>
          <Text style={styles.badgeDay}>{record.checkInAt.toLocaleDateString("en-US", { weekday: "short" })}</Text>
        </View>
        <View style={styles.branchInfo}>
          <Text style={styles.branchName}>{record.branchName}</Text>
          <Text style={styles.branchDate}>
            {record.checkInAt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>
      </View>

      <View style={styles.timeRow}>
        <TimeBlock label="Check In" value={checkInText} icon="login-variant" />
        <View style={styles.verticalDivider} />
        <TimeBlock label="Check Out" value={checkOutText} icon="logout-variant" />
        <View style={styles.verticalDivider} />
        <TimeBlock label="Total" value={totalText} icon="clock-outline" />
      </View>
    </View>
  );
}

function TimeBlock({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
}) {
  return (
    <View style={styles.timeBlock}>
      <View style={styles.timeLabelRow}>
        <MaterialCommunityIcons name={icon} size={11} color="#8FA89A" />
        <Text style={styles.timeLabel}>{label}</Text>
      </View>
      <Text style={styles.timeValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F2FBF6",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 14,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  scroll: {
    paddingTop: 8,
    paddingBottom: 120,
  },

  // Summary
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  summaryChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryValue: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0B2A1E",
    lineHeight: 20,
  },
  summaryLabel: {
    fontSize: 10,
    color: "#8FA89A",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 1,
  },

  // Month nav
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C6E8D5",
  },
  navLabel: {
    fontSize: 13,
    color: "#0B2A1E",
    fontWeight: "500",
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0B2A1E",
  },

  // Calendar
  calendarCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  calRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  dayHeader: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    color: "#8FA89A",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  calGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calCell: {
    // 14.2857% (not 100/7 ≈ 14.285714…%) so 7 cells stay just under 100% and
    // the 7th column (Saturday) doesn't wrap to the next row.
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  calCellSelected: {
    borderRadius: 10,
  },
  calCellSelectedEmpty: {
    backgroundColor: "rgba(5, 150, 105, 0.12)",
  },
  calDate: {
    fontSize: 14,
    color: "#0B2A1E",
    fontWeight: "500",
  },
  calDateSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 2,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#DAF1E6",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 11,
    color: "#8FA89A",
    fontWeight: "600",
  },

  // Section label
  sectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0B2A1E",
    marginBottom: 12,
  },

  // Messages
  messageText: {
    textAlign: "center",
    marginVertical: 12,
    color: "#5A7264",
    fontWeight: "600",
  },
  errorText: {
    textAlign: "center",
    marginBottom: 12,
    color: "#B91C1C",
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: "#8FA89A",
    fontWeight: "500",
  },

  // Attendance card
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  dateBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5, 150, 105, 0.08)",
  },
  badgeDate: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24,
    color: "#059669",
  },
  badgeDay: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#059669",
  },
  branchInfo: {
    flex: 1,
    gap: 4,
  },
  branchName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0B2A1E",
  },
  branchDate: {
    fontSize: 12,
    color: "#8FA89A",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E7F7EF",
    borderRadius: 12,
    paddingVertical: 12,
  },
  timeBlock: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  timeLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  timeValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0B2A1E",
    fontVariant: ["tabular-nums"],
  },
  timeLabel: {
    fontSize: 10,
    color: "#8FA89A",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  verticalDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#C6E8D5",
  },
});
