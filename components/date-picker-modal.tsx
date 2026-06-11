import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/theme";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Lightweight cross-platform (web + native) calendar date picker — no native
// module, so it works in the Expo web build too.
export function DatePickerModal({
  visible,
  initialDate,
  minDate,
  title = "Select date",
  onSelect,
  onClose,
}: {
  visible: boolean;
  initialDate: Date;
  minDate?: Date;
  title?: string;
  onSelect: (date: Date) => void;
  onClose: () => void;
}) {
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  const min = minDate ? startOfDay(minDate).getTime() : null;
  const selected = startOfDay(initialDate).getTime();

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.monthNav}>
            <Pressable onPress={goPrev} style={styles.navBtn} hitSlop={6}>
              <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {MONTHS[viewMonth]} {viewYear}
            </Text>
            <Pressable onPress={goNext} style={styles.navBtn} hitSlop={6}>
              <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {DAY_LABELS.map((d) => (
              <Text key={d} style={styles.weekLabel}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((cell, idx) => {
              if (cell === null) return <View key={`e-${idx}`} style={styles.cell} />;
              const cellTime = new Date(viewYear, viewMonth, cell).getTime();
              const disabled = min !== null && cellTime < min;
              const isSelected = cellTime === selected;
              return (
                <Pressable
                  key={cell}
                  disabled={disabled}
                  onPress={() => onSelect(new Date(viewYear, viewMonth, cell))}
                  style={styles.cell}
                >
                  <View style={[styles.dayBubble, isSelected && styles.dayBubbleSelected]}>
                    <Text
                      style={[
                        styles.dayText,
                        disabled && styles.dayTextDisabled,
                        isSelected && styles.dayTextSelected,
                      ]}
                    >
                      {cell}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 42, 30, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.cardSurface,
    borderRadius: 22,
    padding: 18,
    shadowColor: Colors.shadowWarm,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.warmSurface,
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 8,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.warmSurface,
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  weekRow: {
    flexDirection: "row",
    marginTop: 4,
    marginBottom: 4,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textFaint,
    textTransform: "uppercase",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubbleSelected: {
    backgroundColor: Colors.primary,
  },
  dayText: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.textPrimary,
  },
  dayTextDisabled: {
    color: Colors.textPlaceholder,
  },
  dayTextSelected: {
    color: Colors.textOnDark,
    fontWeight: "700",
  },
});
