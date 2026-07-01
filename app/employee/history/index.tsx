import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AttendanceRecord, getRecentAttendance } from "@/lib/attendance";
import { Holiday, getHoliday, holidayColor, holidaysInMonth } from "@/lib/holidays";

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

function cellYMD(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function isLate(date: Date) {
  return date.getHours() * 60 + date.getMinutes() > 9 * 60 + 35;
}

type DayStatus = "present" | "late" | "absent";

function statusColor(status: DayStatus) {
  if (status === "present") return "#2F6B4F";
  if (status === "late") return "#9A7B3F";
  return "#B23A3A";
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
    // A non-working holiday with no scan isn't an absence.
    if (getHoliday(cellYMD(year, month, day))) return undefined;
    return "absent";
  };

  // Holidays for the displayed month, plus the one on the selected day (if any).
  const monthHolidays = useMemo(() => holidaysInMonth(year, month), [year, month]);
  const selectedHoliday: Holiday | null =
    selectedDate !== null ? getHoliday(cellYMD(year, month, selectedDate)) : null;

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
      if (getHoliday(cellYMD(year, month, day))) continue; // holidays aren't absences
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
          <Ionicons name="refresh" size={18} color="#141414" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: inset }]}
      >
        {/* ── Summary chips ── */}
        <View style={styles.summaryRow}>
          <SummaryChip label="Present" value={summary.present} color="#2F6B4F" />
          <SummaryChip label="Late" value={summary.late} color="#9A7B3F" />
          <SummaryChip label="Absent" value={summary.absent} color="#B23A3A" />
        </View>

        {/* ── Month navigation ── */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={goPrev} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={18} color="#141414" />
            <Text style={styles.navLabel}>Prev</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity onPress={goNext} style={styles.navBtn}>
            <Text style={styles.navLabel}>Next</Text>
            <Ionicons name="chevron-forward" size={18} color="#141414" />
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
              const holiday = getHoliday(cellYMD(year, month, cell));
              const isSelected = cell === selectedDate;
              // A worked-on holiday keeps its attendance dot; an idle holiday
              // shows the holiday colour instead.
              const dotColor = status
                ? statusColor(status)
                : holiday
                  ? holidayColor(holiday.type)
                  : undefined;
              const bgColor = isSelected
                ? status
                  ? statusColor(status)
                  : holiday
                    ? holidayColor(holiday.type)
                    : undefined
                : undefined;

              return (
                <TouchableOpacity
                  key={cell}
                  style={[
                    styles.calCell,
                    isSelected && styles.calCellSelected,
                    isSelected && bgColor && { backgroundColor: bgColor },
                    isSelected && !bgColor && styles.calCellSelectedEmpty,
                  ]}
                  onPress={() => setSelectedDate(prev => prev === cell ? null : cell)}
                  activeOpacity={0.7}
                >
                  {/* Top spacer mirrors the dot slot below so the number stays
                      vertically centered in the cell (and in the selected box). */}
                  <View style={styles.dotSlot} />
                  <Text style={[styles.calDate, isSelected && bgColor && styles.calDateSelected]}>
                    {cell}
                  </Text>
                  <View style={styles.dotSlot}>
                    {dotColor && !isSelected ? (
                      <View style={[styles.dot, { backgroundColor: dotColor }]} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.legend}>
            <LegendItem color="#2F6B4F" label="Present" />
            <LegendItem color="#9A7B3F" label="Late" />
            <LegendItem color="#B23A3A" label="Absent" />
            <LegendItem color="#1A1A1A" label="Holiday" />
          </View>
        </View>

        {/* ── Holidays this month ── */}
        {monthHolidays.length > 0 && (
          <View style={styles.holidayCard}>
            <View style={styles.holidayCardHeader}>
              <MaterialCommunityIcons name="party-popper" size={15} color="#1A1A1A" />
              <Text style={styles.holidayCardTitle}>Holidays this month</Text>
            </View>
            {monthHolidays.map((h) => {
              const day = Number(h.date.slice(8, 10));
              return (
                <TouchableOpacity
                  key={h.date}
                  style={styles.holidayRow}
                  onPress={() => setSelectedDate(day)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.holidayDot, { backgroundColor: holidayColor(h.type) }]} />
                  <Text style={styles.holidayDate}>{MONTHS[month].slice(0, 3)} {day}</Text>
                  <Text style={styles.holidayName} numberOfLines={1}>{h.name}</Text>
                  <Text
                    style={[
                      styles.holidayType,
                      { color: holidayColor(h.type) },
                    ]}
                  >
                    {h.type === "regular" ? "Regular" : "Special"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Records list ── */}
        <Text style={styles.sectionLabel}>
          {selectedDate !== null
            ? `${MONTHS[month]} ${selectedDate}, ${year}`
            : "Recent Records"}
        </Text>

        {selectedHoliday && (
          <View style={[styles.holidayBanner, { borderColor: holidayColor(selectedHoliday.type) }]}>
            <MaterialCommunityIcons
              name="calendar-star"
              size={16}
              color={holidayColor(selectedHoliday.type)}
            />
            <Text style={styles.holidayBannerText}>
              {selectedHoliday.name}
              <Text style={styles.holidayBannerType}>
                {"  ·  "}
                {selectedHoliday.type === "regular" ? "Regular Holiday" : "Special Non-Working"}
              </Text>
            </Text>
          </View>
        )}

        {isLoading ? <Text style={styles.messageText}>Loading attendance...</Text> : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        {filteredRecords.length === 0 && !isLoading ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-remove-outline" size={48} color="#C4C4C4" />
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
        <MaterialCommunityIcons name={icon} size={11} color="#A8A8A8" />
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
    backgroundColor: "#F7F5F0",
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
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
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
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryValue: {
    fontSize: 17,
    fontWeight: "700",
    color: "#141414",
    lineHeight: 20,
  },
  summaryLabel: {
    fontSize: 10,
    color: "#A8A8A8",
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
    borderColor: "#E3DED4",
  },
  navLabel: {
    fontSize: 13,
    color: "#141414",
    fontWeight: "500",
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#141414",
  },

  // Calendar
  calendarCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
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
    color: "#A8A8A8",
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
    backgroundColor: "rgba(10, 10, 10, 0.10)",
  },
  calDate: {
    fontSize: 14,
    color: "#141414",
    fontWeight: "500",
  },
  calDateSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
  dotSlot: {
    // Fixed-height slot above and below the number. Reserving this space (rather
    // than absolutely positioning the dot) keeps the number centered and the dot
    // from overlapping it, and stops the number from jumping when selection hides
    // the dot.
    height: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#EAE6DD",
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
    color: "#A8A8A8",
    fontWeight: "600",
  },

  // Holidays this month
  holidayCard: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
  },
  holidayCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  holidayCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#141414",
    letterSpacing: 0.2,
  },
  holidayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 7,
  },
  holidayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  holidayDate: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A8A8A",
    width: 46,
    fontVariant: ["tabular-nums"],
  },
  holidayName: {
    flex: 1,
    fontSize: 13,
    color: "#141414",
    fontWeight: "500",
  },
  holidayType: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  holidayBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  holidayBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: "#141414",
  },
  holidayBannerType: {
    fontSize: 11,
    fontWeight: "600",
    color: "#A8A8A8",
  },

  // Section label
  sectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#141414",
    marginBottom: 12,
  },

  // Messages
  messageText: {
    textAlign: "center",
    marginVertical: 12,
    color: "#8A8A8A",
    fontWeight: "600",
  },
  errorText: {
    textAlign: "center",
    marginBottom: 12,
    color: "#8E2F2F",
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: "#A8A8A8",
    fontWeight: "500",
  },

  // Attendance card
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
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
    backgroundColor: "rgba(10, 10, 10, 0.05)",
  },
  badgeDate: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24,
    color: "#0A0A0A",
  },
  badgeDay: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#0A0A0A",
  },
  branchInfo: {
    flex: 1,
    gap: 4,
  },
  branchName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#141414",
  },
  branchDate: {
    fontSize: 12,
    color: "#A8A8A8",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F2EFE9",
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
    color: "#141414",
    fontVariant: ["tabular-nums"],
  },
  timeLabel: {
    fontSize: 10,
    color: "#A8A8A8",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  verticalDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#E3DED4",
  },
});
