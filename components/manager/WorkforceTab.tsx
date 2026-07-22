import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BarChart, BarDatum } from "@/components/manager/BarChart";
import { Card, EmptyState, SectionTitle, StatTile } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { subscribeAllRequests } from "@/lib/attendance-requests";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { silBalance, tenureYears } from "@/lib/leave-benefits";
import { subscribeAllLeaves } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { peso } from "@/lib/ph-payroll";

const WORK_DAYS = 22; // rough monthly working days for a labor-cost estimate

function countBy<T>(items: T[], key: (t: T) => string): BarDatum[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it) || "—";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export function WorkforceTab({ allowed }: { allowed: Set<string> | null }) {
  const [all, setAll] = useState<EmployeeMaster[]>([]);
  const [leaves, setLeaves] = useState<{ employeeId: string; status: string; startDate: string }[]>([]);
  const [pendingReq, setPendingReq] = useState(0);

  useEffect(() => subscribeEmployeeMasters(setAll, () => setAll([])), []);
  useEffect(() => subscribeAllLeaves(setLeaves as never, () => setLeaves([])), []);
  useEffect(() => subscribeAllRequests((r) => setPendingReq(r.filter((x) => x.status === "pending").length), () => setPendingReq(0)), []);

  const year = new Date().getFullYear();
  const emps = useMemo(() => all.filter((e) => inScope(e.branchId, allowed)), [all, allowed]);
  const active = emps.filter((e) => e.status === "active");

  const byBranch = useMemo(() => countBy(active, (e) => e.branchName ?? "Unassigned"), [active]);
  const byDept = useMemo(() => countBy(active, (e) => e.department || "Unassigned"), [active]);
  const byRole = useMemo(() => countBy(active, (e) => e.accessRole), [active]);

  const tenure = useMemo(() => {
    const bands = { "< 1 yr": 0, "1–3 yrs": 0, "3+ yrs": 0 };
    for (const e of active) {
      const t = tenureYears(e.hireDate);
      if (t < 1) bands["< 1 yr"] += 1;
      else if (t < 3) bands["1–3 yrs"] += 1;
      else bands["3+ yrs"] += 1;
    }
    return Object.entries(bands).map(([label, value]) => ({ label, value }));
  }, [active]);

  const pendingLeaves = useMemo(() => leaves.filter((l) => l.status === "pending").length, [leaves]);

  const silRemaining = useMemo(
    () => active.reduce((s, e) => s + silBalance(e.hireDate, leaves as never, e.employeeId, year).remaining, 0),
    [active, leaves, year],
  );

  const laborCost = useMemo(
    () => active.reduce((s, e) => s + (e.dailyRate ?? (e.hourlyRate != null ? e.hourlyRate * 8 : 0)) * WORK_DAYS, 0),
    [active],
  );

  if (emps.length === 0) {
    return <EmptyState icon="account-group-outline" text="No employees in scope yet" />;
  }

  return (
    <View>
      <View style={styles.tiles}>
        <StatTile label="Headcount" value={active.length} sub={`${emps.length - active.length} inactive`} icon="account-group" tone="neutral" />
        <StatTile label="Pending Approvals" value={pendingLeaves + pendingReq} sub={`${pendingLeaves} leave · ${pendingReq} OT/corr`} icon="clipboard-text-clock-outline" tone="critical" />
        <StatTile label="SIL Days Left" value={Math.round(silRemaining)} sub={`${year} · all staff`} icon="calendar-check-outline" tone="primary" />
        <StatTile label="Est. Monthly Labor" value={peso(laborCost)} sub={`${WORK_DAYS} days basis`} icon="cash-multiple" tone="neutral" />
      </View>

      <SectionTitle>Headcount by Branch</SectionTitle>
      <Card><BarChart data={byBranch} /></Card>

      <SectionTitle>Headcount by Department</SectionTitle>
      <Card><BarChart data={byDept} color={Colors.accent} /></Card>

      <View style={styles.two}>
        <View style={styles.col}>
          <SectionTitle>Tenure</SectionTitle>
          <Card>
            {tenure.map((t) => (
              <Line key={t.label} label={t.label} value={String(t.value)} />
            ))}
          </Card>
        </View>
        <View style={styles.col}>
          <SectionTitle>Access Roles</SectionTitle>
          <Card>
            {byRole.map((r) => (
              <Line key={r.label} label={r.label} value={String(r.value)} />
            ))}
          </Card>
        </View>
      </View>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginBottom: 8 },
  two: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  col: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  lineLabel: { fontSize: 14, color: Colors.textBody, textTransform: "capitalize" },
  lineValue: { fontSize: 14, fontWeight: "800", color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
});
