import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { silBalance, tenureYears } from "@/lib/leave-benefits";
import { LEAVE_TYPES, LeaveRequest, formatRange, subscribeAllLeaves } from "@/lib/leaves";
import { inScope } from "@/lib/org";

const ICON: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  vacation: "umbrella-beach",
  sick: "medical-bag",
  emergency: "alarm-light-outline",
  unpaid: "cash-remove",
};
function tint(type: string) {
  return LEAVE_TYPES.find((t) => t.key === type)?.tint ?? Colors.primary;
}
function typeLabel(type: string) {
  return LEAVE_TYPES.find((t) => t.key === type)?.label ?? "Leave";
}

export function LeavesTab({ allowed }: { allowed: Set<string> | null }) {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  useEffect(() => subscribeAllLeaves(setItems, () => setItems([])), []);
  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);

  const year = new Date().getFullYear();
  const balances = useMemo(
    () =>
      employees
        .filter((e) => e.status === "active" && inScope(e.branchId, allowed))
        .map((e) => ({
          e,
          tenure: tenureYears(e.hireDate),
          bal: silBalance(e.hireDate, items, e.employeeId, year),
        }))
        .sort((a, b) => a.e.fullName.localeCompare(b.e.fullName)),
    [employees, items, allowed, year],
  );

  return (
    <View>
      {/* ── Service Incentive Leave balances (DOLE: 5 paid days/yr after 1 yr) ── */}
      <SectionTitle>Service Incentive Leave · {year}</SectionTitle>
      {balances.length === 0 ? (
        <EmptyState icon="calendar-account-outline" text="No active employees in scope" />
      ) : (
        <Card>
          <View style={[styles.tr, styles.thead]}>
            <Text style={[styles.th, styles.cName]}>Employee</Text>
            <Text style={[styles.th, styles.cNum]}>Tenure</Text>
            <Text style={[styles.th, styles.cNum]}>Entitled</Text>
            <Text style={[styles.th, styles.cNum]}>Used</Text>
            <Text style={[styles.th, styles.cNum]}>Remaining</Text>
          </View>
          {balances.map(({ e, tenure, bal }) => (
            <View key={e.employeeId} style={styles.tr}>
              <View style={styles.cName}>
                <Text style={styles.rName} numberOfLines={1}>{e.fullName}</Text>
                <Text style={styles.rSub} numberOfLines={1}>{e.employeeId}{e.branchName ? ` · ${e.branchName}` : ""}</Text>
              </View>
              <Text style={[styles.td, styles.cNum]}>{tenure < 1 ? "<1 yr" : `${tenure.toFixed(1)} yr`}</Text>
              <Text style={[styles.td, styles.cNum]}>{bal.entitled}</Text>
              <Text style={[styles.td, styles.cNum]}>{bal.used}</Text>
              <Text style={[styles.td, styles.cNum, styles.remainVal]}>{bal.remaining}</Text>
            </View>
          ))}
          <Text style={styles.note}>
            SIL = 5 paid days per year after one year of service; used = approved paid leave (vacation / sick / emergency).
            The remaining balance is convertible to cash (see Final Pay).
          </Text>
        </Card>
      )}

      <SectionTitle>All Leave Requests</SectionTitle>
      {items.length === 0 ? (
        <EmptyState icon="calendar-blank-outline" text="No leave requests yet" />
      ) : (
        items.map((l) => (
          <Card key={l.id}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: tint(l.type) + "1A" }]}>
                <MaterialCommunityIcons name={ICON[l.type] ?? "note-text-outline"} size={22} color={tint(l.type)} />
              </View>
              <View style={styles.grow}>
                <Text style={styles.title}>{l.employeeName}</Text>
                <Text style={styles.sub}>
                  {typeLabel(l.type)} · {formatRange(l.startDate, l.endDate)} · {l.days} day{l.days > 1 ? "s" : ""}
                </Text>
                {l.reviewedBy ? (
                  <Text style={styles.sub}>
                    {l.status === "approved" ? "Approved" : l.status === "rejected" ? "Rejected" : "Reviewed"} by {l.reviewedBy}
                  </Text>
                ) : null}
              </View>
              <Badge
                label={l.status[0].toUpperCase() + l.status.slice(1)}
                tone={l.status as "pending" | "approved" | "rejected"}
              />
            </View>
            {l.reason ? <Text style={styles.reason}>{l.reason}</Text> : null}
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  icon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: "700", fontSize: 15, color: Colors.textPrimary },
  sub: { color: Colors.textFaint, fontSize: 13 },
  reason: { marginTop: 12, color: Colors.textMuted, fontSize: 14, lineHeight: 20 },

  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 11, gap: 6, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  thead: { backgroundColor: Colors.warmSurface, borderRadius: 8, borderBottomWidth: 0, paddingVertical: 9 },
  th: { fontSize: 11, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { fontSize: 13, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  cName: { flex: 1, minWidth: 0 },
  cNum: { width: 72, textAlign: "right" },
  rName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  rSub: { fontSize: 12, color: Colors.textFaint, marginTop: 1 },
  remainVal: { fontWeight: "800", color: Colors.primary },
  note: { marginTop: 12, fontSize: 11, color: Colors.textMuted, lineHeight: 15, fontStyle: "italic" },
});
