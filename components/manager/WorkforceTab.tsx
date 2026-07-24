import React, { useEffect, useMemo, useState } from "react";
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from "react-native";

import { BarChart, BarDatum, BarMember } from "@/components/manager/BarChart";
import { Card, EmptyState, SectionTitle, StatTile } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { subscribeAllRequests } from "@/lib/attendance-requests";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { silBalance, tenureYears } from "@/lib/leave-benefits";
import { subscribeAllLeaves } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { peso } from "@/lib/ph-payroll";

const WORK_DAYS = 22; // rough monthly working days for a labor-cost estimate

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Group employees into {label, value, members} buckets sorted by size — members
// carry the names so a bar or meter can reveal *who* on hover/tap.
function groupBy(
  items: EmployeeMaster[],
  key: (e: EmployeeMaster) => string,
  meta: (e: EmployeeMaster) => string | undefined,
): BarDatum[] {
  const m = new Map<string, BarMember[]>();
  for (const e of items) {
    const k = key(e) || "—";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ name: e.fullName, meta: meta(e) });
  }
  return [...m.entries()]
    .map(([label, members]) => ({ label, value: members.length, members: sortMembers(members) }))
    .sort((a, b) => b.value - a.value);
}

function sortMembers(members: BarMember[]): BarMember[] {
  return [...members].sort((a, b) => a.name.localeCompare(b.name));
}

// Turn a camelCase role key into spaced Title Case: "AreaManager" → "Area Manager".
function humanize(s: string): string {
  const spaced = s.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

  const byBranch = useMemo(() => groupBy(active, (e) => e.branchName ?? "Unassigned", (e) => e.department || undefined), [active]);
  const byDept = useMemo(() => groupBy(active, (e) => e.department || "Unassigned", (e) => e.position || undefined), [active]);
  const byRole = useMemo(
    () => groupBy(active, (e) => e.accessRole, (e) => e.branchName || undefined).map((d) => ({ ...d, label: humanize(d.label) })),
    [active],
  );

  const tenure = useMemo<BarDatum[]>(() => {
    const bands: { label: string; members: BarMember[] }[] = [
      { label: "< 1 Yr", members: [] },
      { label: "1–3 Yrs", members: [] },
      { label: "3+ Yrs", members: [] },
    ];
    for (const e of active) {
      const t = tenureYears(e.hireDate);
      const idx = t < 1 ? 0 : t < 3 ? 1 : 2;
      bands[idx].members.push({ name: e.fullName, meta: e.position || undefined });
    }
    return bands.map((b) => ({ label: b.label, value: b.members.length, members: sortMembers(b.members) }));
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

      <View style={styles.two}>
        <View style={styles.col}>
          <SectionTitle>Headcount by Branch</SectionTitle>
          <Card>
            <ChartHint />
            <BarChart data={byBranch} />
          </Card>
        </View>
        <View style={styles.col}>
          <SectionTitle>Headcount by Department</SectionTitle>
          <Card>
            <ChartHint />
            <BarChart data={byDept} color={Colors.accent} />
          </Card>
        </View>
      </View>

      <View style={styles.two}>
        <View style={styles.col}>
          <SectionTitle>Tenure</SectionTitle>
          <Card><MeterList data={tenure} color={Colors.primary} /></Card>
        </View>
        <View style={styles.col}>
          <SectionTitle>Access Roles</SectionTitle>
          <Card><MeterList data={byRole} color={Colors.accent} /></Card>
        </View>
      </View>
    </View>
  );
}

function ChartHint() {
  return (
    <Text style={styles.hint}>Hover or tap a bar to see who’s in it</Text>
  );
}

// A horizontal proportional-meter list: each row shows a filled track sized to
// its share, and tapping expands the member names inline (so touch users get the
// same "who is this" answer that hover gives on the bar charts).
function MeterList({ data, color }: { data: BarDatum[]; color: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  if (data.length === 0) return <Text style={styles.hint}>No data yet</Text>;

  return (
    <View style={{ gap: 2 }}>
      {data.map((d, i) => {
        const isOpen = open === d.label;
        const pct = Math.round((d.value / total) * 100);
        return (
          <View key={d.label}>
            <Pressable
              style={({ hovered }: { hovered?: boolean }) => [styles.meterRow, hovered && styles.meterRowHover, i > 0 && styles.meterDivider]}
              onPress={() => {
                if (Platform.OS !== "web") LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setOpen((o) => (o === d.label ? null : d.label));
              }}
            >
              <Text style={styles.meterLabel}>{d.label}</Text>
              <View style={styles.meterTrack}>
                <View style={[styles.meterFill, { width: `${Math.max(3, (d.value / max) * 100)}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.meterPct}>{pct}%</Text>
              <Text style={styles.meterValue}>{d.value}</Text>
            </Pressable>
            {isOpen && d.members && d.members.length > 0 && (
              <View style={styles.members}>
                {d.members.map((m, j) => (
                  <View key={j} style={styles.memberChip}>
                    <Text style={styles.memberName} numberOfLines={1}>{m.name}</Text>
                    {m.meta ? <Text style={styles.memberMeta} numberOfLines={1}>· {m.meta}</Text> : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginBottom: 8 },
  two: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  col: { flexGrow: 1, flexBasis: 300, minWidth: 0 },

  hint: { fontSize: 12, color: Colors.textFaint, fontWeight: "500", marginBottom: 6 },

  meterRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 6, borderRadius: 10 },
  meterRowHover: { backgroundColor: Colors.warmSurface },
  meterDivider: { borderTopWidth: 1, borderTopColor: Colors.hairline },
  meterLabel: { width: 104, fontSize: 13.5, color: Colors.textBody, fontWeight: "600", textTransform: "capitalize" },
  meterTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: Colors.warmSurfaceAlt, overflow: "hidden" },
  meterFill: { height: 8, borderRadius: 999 },
  meterPct: { width: 40, textAlign: "right", fontSize: 12, color: Colors.textFaint, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meterValue: { width: 26, textAlign: "right", fontSize: 14, fontWeight: "800", color: Colors.textPrimary, fontVariant: ["tabular-nums"] },

  members: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingHorizontal: 6, paddingBottom: 12, paddingTop: 2 },
  memberChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  memberName: { fontSize: 12.5, fontWeight: "700", color: Colors.textBody },
  memberMeta: { fontSize: 11.5, color: Colors.textFaint, fontWeight: "500" },
});
