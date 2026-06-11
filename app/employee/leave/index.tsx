import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { DatePickerModal } from "@/components/date-picker-modal";
import { Colors } from "@/constants/theme";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import {
  LEAVE_TYPES,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  countDays,
  fileLeave,
  formatRange,
  fromYMD,
  subscribeMyLeaves,
  toYMD,
} from "@/lib/leaves";

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const STATUS_META: Record<LeaveStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: Colors.warningDeep, bg: Colors.warningSurface },
  approved: { label: "Approved", color: Colors.success, bg: Colors.successTint },
  rejected: { label: "Rejected", color: Colors.danger, bg: Colors.dangerTint },
};

export default function LeaveScreen() {
  const router = useRouter();
  const inset = useResponsiveInset(18);
  const { employee } = useSession();

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<LeaveType>("vacation");
  const [startDate, setStartDate] = useState(toYMD(new Date()));
  const [endDate, setEndDate] = useState(toYMD(new Date()));
  const [reason, setReason] = useState("");
  const [picker, setPicker] = useState<null | "start" | "end">(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!employee) router.replace("/login");
  }, [employee, router]);

  useEffect(() => {
    if (!employee) return;
    const unsub = subscribeMyLeaves(employee.employeeId, setLeaves, () => setLeaves([]));
    return unsub;
  }, [employee]);

  const days = useMemo(() => countDays(startDate, endDate), [startDate, endDate]);
  const valid = days > 0 && reason.trim().length > 0;

  const resetForm = () => {
    setType("vacation");
    setStartDate(toYMD(new Date()));
    setEndDate(toYMD(new Date()));
    setReason("");
  };

  const onSubmit = async () => {
    if (!valid || submitting || !employee) return;
    try {
      setSubmitting(true);
      setMessage("");
      await fileLeave(employee, { type, startDate, endDate, reason });
      resetForm();
      setFormOpen(false);
      setMessage("Leave request submitted. Your manager will review it.");
    } catch (error) {
      console.error(error);
      setMessage("Couldn't submit. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!employee) return null;

  return (
    <View style={styles.screen}>
      <AmbientTop height={220} />

      <View style={[styles.header, { paddingHorizontal: inset }]}>
        <BrandTitle size={28} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: inset }]}
      >
        <Pressable
          style={[styles.fileToggle, formOpen && styles.fileToggleOpen]}
          onPress={() => setFormOpen((v) => !v)}
        >
          <View style={styles.fileToggleIcon}>
            <Ionicons name={formOpen ? "remove" : "add"} size={18} color={Colors.textOnDark} />
          </View>
          <Text style={styles.fileToggleText}>{formOpen ? "Close form" : "File a Leave Request"}</Text>
        </Pressable>

        {formOpen ? (
          <View style={styles.formCard}>
            <Text style={styles.fieldLabel}>Leave type</Text>
            <View style={styles.typeRow}>
              {LEAVE_TYPES.map((t) => {
                const active = t.key === type;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setType(t.key)}
                    style={[styles.typeChip, active && { borderColor: t.tint, backgroundColor: `${t.tint}14` }]}
                  >
                    <MaterialCommunityIcons
                      name={t.icon as MdIcon}
                      size={16}
                      color={active ? t.tint : Colors.textFaint}
                    />
                    <Text style={[styles.typeChipText, active && { color: t.tint }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.fieldLabel}>From</Text>
                <Pressable style={styles.dateInput} onPress={() => setPicker("start")}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
                  <Text style={styles.dateValue}>
                    {fromYMD(startDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.dateField}>
                <Text style={styles.fieldLabel}>To</Text>
                <Pressable style={styles.dateInput} onPress={() => setPicker("end")}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
                  <Text style={styles.dateValue}>
                    {fromYMD(endDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.daysPill}>
              <MaterialCommunityIcons name="calendar-range" size={14} color={Colors.primary} />
              <Text style={styles.daysPillText}>
                {days > 0 ? `${days} day${days > 1 ? "s" : ""}` : "End date is before start date"}
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Reason</Text>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Briefly describe the reason for your leave"
              placeholderTextColor={Colors.textPlaceholder}
              multiline
            />

            <Pressable
              style={[styles.submitBtn, (!valid || submitting) && styles.submitBtnDisabled]}
              onPress={onSubmit}
              disabled={!valid || submitting}
            >
              <Text style={styles.submitBtnText}>{submitting ? "Submitting…" : "Submit Request"}</Text>
            </Pressable>
          </View>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Text style={styles.sectionLabel}>My Requests</Text>
        {leaves.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="palm-tree" size={46} color={Colors.textPlaceholder} />
            <Text style={styles.emptyText}>No leave requests yet</Text>
          </View>
        ) : (
          leaves.map((leave) => <LeaveCard key={leave.id} leave={leave} />)
        )}
      </ScrollView>

      <DatePickerModal
        visible={picker === "start"}
        initialDate={fromYMD(startDate)}
        title="Start date"
        onSelect={(d) => {
          const ymd = toYMD(d);
          setStartDate(ymd);
          if (fromYMD(endDate) < d) setEndDate(ymd);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <DatePickerModal
        visible={picker === "end"}
        initialDate={fromYMD(endDate)}
        minDate={fromYMD(startDate)}
        title="End date"
        onSelect={(d) => {
          setEndDate(toYMD(d));
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />

      <BottomNav active="leave" />
    </View>
  );
}

function LeaveCard({ leave }: { leave: LeaveRequest }) {
  const meta = LEAVE_TYPES.find((t) => t.key === leave.type) ?? LEAVE_TYPES[0];
  const status = STATUS_META[leave.status];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: `${meta.tint}14` }]}>
          <MaterialCommunityIcons name={meta.icon as MdIcon} size={20} color={meta.tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardType}>{meta.label} Leave</Text>
          <Text style={styles.cardRange}>
            {formatRange(leave.startDate, leave.endDate)} · {leave.days} day{leave.days > 1 ? "s" : ""}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {leave.reason ? <Text style={styles.cardReason}>{leave.reason}</Text> : null}

      {leave.status !== "pending" && leave.reviewedBy ? (
        <Text style={styles.reviewedBy}>
          {leave.status === "approved" ? "Approved" : "Rejected"} by {leave.reviewedBy}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 12,
  },
  scroll: { paddingTop: 12, paddingBottom: 120 },

  fileToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 5,
  },
  fileToggleOpen: { backgroundColor: Colors.primaryDark },
  fileToggleIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  fileToggleText: { color: Colors.textOnDark, fontSize: 15, fontWeight: "700" },

  formCard: {
    marginTop: 12,
    backgroundColor: Colors.cardSurface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    gap: 10,
  },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: Colors.textBody, letterSpacing: 0.2 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.cardSurface,
  },
  typeChipText: { fontSize: 13, fontWeight: "600", color: Colors.textSubtle },
  dateRow: { flexDirection: "row", gap: 10 },
  dateField: { flex: 1, gap: 8 },
  dateInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  dateValue: { fontSize: 13, fontWeight: "600", color: Colors.textPrimary },
  daysPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Colors.primaryTint,
  },
  daysPillText: { fontSize: 12, fontWeight: "600", color: Colors.primaryDark },
  reasonInput: {
    minHeight: 72,
    borderRadius: 12,
    padding: 12,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    color: Colors.textPrimary,
    fontSize: 14,
    textAlignVertical: "top",
  },
  submitBtn: {
    marginTop: 4,
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: Colors.textOnDark, fontSize: 15, fontWeight: "700" },

  message: {
    marginTop: 12,
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSubtle,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 12,
  },
  empty: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, color: Colors.textFaint, fontWeight: "500" },

  card: {
    backgroundColor: Colors.cardSurface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: Colors.shadowWarm,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardType: { fontSize: 13, fontWeight: "600", color: Colors.textBody },
  cardRange: { fontSize: 12, color: Colors.textFaint, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: "700" },
  cardReason: { marginTop: 10, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  reviewedBy: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textFaint,
    fontStyle: "italic",
  },
});
