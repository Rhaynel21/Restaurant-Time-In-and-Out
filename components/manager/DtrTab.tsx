import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Badge, Button, Card, EmptyState, Field, InlineMessage, SectionTitle, Select, TextField } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRequest, subscribeAllRequests } from "@/lib/attendance-requests";
import { getAttendanceForMonth } from "@/lib/attendance";
import { Dtr, DtrRow, buildDtr, formatClock, formatHours, statusLabel } from "@/lib/dtr";
import { DtrLock, isPeriodLocked, lockFor, lockPeriod, subscribeDtrLocks, unlockPeriod } from "@/lib/dtr-lock";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import { LeaveRequest, subscribeAllLeaves } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { getSchedule } from "@/lib/schedules";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DtrTab({ allowed, actorName }: { allowed: Set<string> | null; actorName: string }) {
  const [allEmployees, setAllEmployees] = useState<EmployeeSummary[]>([]);
  const employees = allEmployees.filter((e) => inScope(e.branchId, allowed));
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonthValue());
  const [dtr, setDtr] = useState<Dtr | null>(null);
  const [meta, setMeta] = useState<{ emp: EmployeeSummary; label: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [allRequests, setAllRequests] = useState<AttendanceRequest[]>([]);
  const [locks, setLocks] = useState<DtrLock[]>([]);
  const [lockNote, setLockNote] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  useEffect(() => subscribeEmployees(setAllEmployees, () => setAllEmployees([])), []);
  useEffect(() => subscribeAllLeaves(setAllLeaves, () => setAllLeaves([])), []);
  useEffect(() => subscribeAllRequests(setAllRequests, () => setAllRequests([])), []);
  useEffect(() => subscribeDtrLocks(setLocks, () => setLocks([])), []);

  // The cutoff lock applies to the selected employee's branch + the chosen month.
  const selectedEmp = employees.find((e) => e.employeeId === employeeId) ?? null;
  const lockBranchId = selectedEmp?.branchId ?? null;
  const validMonth = /^\d{4}-\d{2}$/.test(month);
  const periodLocked = validMonth ? isPeriodLocked(locks, lockBranchId, month) : false;
  const activeLock = validMonth ? lockFor(locks, lockBranchId, month) : null;

  const toggleLock = async () => {
    if (!lockBranchId || !validMonth) return;
    setLockBusy(true);
    setError("");
    try {
      if (periodLocked) await unlockPeriod(lockBranchId, month, actorName);
      else await lockPeriod(lockBranchId, month, actorName, lockNote.trim());
      setLockNote("");
    } catch (e) {
      setError("Lock failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLockBusy(false);
    }
  };

  const generate = async () => {
    setError("");
    const emp = employees.find((e) => e.employeeId === employeeId);
    if (!emp) {
      setError("Pick an employee.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Enter the month as YYYY-MM.");
      return;
    }
    const [y, mo] = month.split("-").map(Number);
    setLoading(true);
    try {
      const [schedule, records] = await Promise.all([
        getSchedule(emp.employeeId),
        getAttendanceForMonth(emp.employeeId, y, mo - 1),
      ]);
      setDtr(buildDtr(y, mo - 1, schedule, records, {
        leaves: allLeaves.filter((l) => l.employeeId === emp.employeeId && l.status === "approved"),
        requests: allRequests.filter((r) => r.employeeId === emp.employeeId && r.status === "approved"),
      }));
      const label = new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      setMeta({ emp, label });
    } catch (e) {
      setError("Failed to generate: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!dtr || !meta || Platform.OS !== "web") return;
    const head = ["Date", "Day", "Schedule", "Time In", "Time Out", "Break", "Hours", "OT", "Undertime", "Night Diff", "Late (min)", "Status"];
    const lines = [head.join(",")];
    for (const r of dtr.rows) {
      const cells = [
        String(r.day).padStart(2, "0"),
        r.weekdayShort,
        r.scheduleLabel,
        formatClock(r.timeIn),
        formatClock(r.timeOut),
        r.breakMinutes ? formatHours(r.breakMinutes) : "",
        r.workedMinutes ? formatHours(r.workedMinutes) : "",
        r.otMinutes ? formatHours(r.otMinutes) : "",
        r.underMinutes ? formatHours(r.underMinutes) : "",
        r.nightMinutes ? formatHours(r.nightMinutes) : "",
        r.lateMinutes ? String(r.lateMinutes) : "",
        statusLabel(r),
      ];
      lines.push(cells.map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DTR_${meta.emp.employeeId}_${meta.label.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Print the filled DTR in the Philippine CSC Form No. 48 layout.
  const printForm = () => {
    if (!dtr || !meta || Platform.OS !== "web") return;
    openPrint(dtrFormHtml({ name: meta.emp.fullName, empId: meta.emp.employeeId, monthLabel: meta.label, rows: dtr.rows }));
  };

  // Download a blank CSC Form No. 48 template (for hand-filling / printing).
  const downloadTemplate = () => {
    if (Platform.OS !== "web") return;
    openPrint(dtrFormHtml({ name: "", empId: "", monthLabel: "", rows: null }));
  };

  const s = dtr?.summary;
  const summaryStats: { label: string; value: string; strong?: boolean; color?: string }[] = s
    ? [
        { label: "Hours", value: formatHours(s.totalMinutes), strong: true },
        { label: "OT", value: formatHours(s.otMinutes), color: s.otMinutes ? Colors.primaryDark : undefined },
        { label: "Undertime", value: formatHours(s.underMinutes), color: s.underMinutes ? Colors.danger : undefined },
        { label: "Night Diff", value: formatHours(s.nightMinutes), color: s.nightMinutes ? "#3B5BDB" : undefined },
        { label: "Break", value: formatHours(s.breakMinutes) },
        { label: "Present", value: String(s.present), color: Colors.success },
        { label: "Late", value: String(s.late), color: s.late ? Colors.warningDeep : undefined },
        { label: "Absent", value: String(s.absent), color: s.absent ? Colors.danger : undefined },
      ]
    : [];

  return (
    <View>
      <SectionTitle>Daily Time Record</SectionTitle>
      <Card>
        <View style={styles.controls}>
          <View style={styles.empCol}>
            <Field label="Employee">
              <Select
                value={employeeId}
                searchable
                placeholder="Search & select employee…"
                options={employees.map((e) => ({ value: e.employeeId, label: e.fullName }))}
                onChange={setEmployeeId}
              />
            </Field>
          </View>
          <View style={styles.monthCol}>
            <TextField label="Month" value={month} onChangeText={setMonth} placeholder="YYYY-MM" />
          </View>
        </View>
        <View style={styles.actions}>
          <Button label="Generate" icon="cog-outline" loading={loading} onPress={generate} />
          <Button label="Print / PDF" variant="ghost" icon="printer-outline" disabled={!dtr} onPress={printForm} />
          <Button label="CSV" variant="ghost" icon="file-delimited-outline" disabled={!dtr} onPress={exportCsv} />
          <View style={styles.actionsGap} />
          <Button label="Download template" variant="link" icon="download-outline" onPress={downloadTemplate} />
        </View>
        {error ? <InlineMessage text={error} tone="error" /> : null}

        {selectedEmp && validMonth ? (
          <View style={[styles.lockStrip, periodLocked && styles.lockStripOn]}>
            <MaterialCommunityIcons
              name={periodLocked ? "lock" : "lock-open-variant-outline"}
              size={18}
              color={periodLocked ? Colors.warningDeep : Colors.textMuted}
            />
            <View style={styles.lockText}>
              <Text style={styles.lockTitle}>
                {periodLocked ? "Cutoff locked" : "Cutoff open"} · {selectedEmp.branchName || "branch"} · {month}
              </Text>
              <Text style={styles.lockSub} numberOfLines={1}>
                {periodLocked
                  ? `Locked by ${activeLock?.lockedBy || "—"}${activeLock?.note ? ` · ${activeLock.note}` : ""}`
                  : "Resolve exceptions, then lock to freeze attendance for payroll."}
              </Text>
            </View>
            {!periodLocked ? (
              <View style={styles.lockNoteCol}>
                <TextField value={lockNote} onChangeText={setLockNote} placeholder="Exception note (optional)" />
              </View>
            ) : null}
            <Button
              label={periodLocked ? "Unlock" : "Lock cutoff"}
              variant={periodLocked ? "ghost" : "primary"}
              size="sm"
              icon={periodLocked ? "lock-open-variant" : "lock"}
              loading={lockBusy}
              onPress={toggleLock}
            />
          </View>
        ) : null}
      </Card>

      {dtr && meta && (
        <Card style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={styles.sheetIconWrap}>
              <MaterialCommunityIcons name="calendar-account" size={22} color={Colors.primary} />
            </View>
            <View style={styles.sheetIdent}>
              <Text style={styles.sheetTitle}>Daily Time Record</Text>
              <Text style={styles.sheetMeta}>
                {meta.emp.fullName} · {meta.emp.employeeId}
                {meta.emp.branchName ? ` · ${meta.emp.branchName}` : ""}
              </Text>
            </View>
            {periodLocked ? (
              <View style={styles.sheetLockPill}>
                <MaterialCommunityIcons name="lock" size={13} color="#fff" />
                <Text style={styles.sheetLockText}>DTR Locked</Text>
              </View>
            ) : null}
            <View style={styles.sheetPeriodPill}>
              <Text style={styles.sheetPeriod}>{meta.label}</Text>
            </View>
          </View>

          <View style={styles.statBand}>
            {summaryStats.map((st, i) => (
              <View key={st.label} style={[styles.statCell, i > 0 && styles.statDivider]}>
                <Text style={[styles.statValue, st.strong && styles.statValueStrong, st.color ? { color: st.color } : null]} numberOfLines={1}>
                  {st.value}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>{st.label}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.tr, styles.thead]}>
            <Text style={[styles.th, styles.cDate]}>Date</Text>
            <Text style={[styles.th, styles.cSched]}>Schedule</Text>
            <Text style={[styles.th, styles.cTime]}>In</Text>
            <Text style={[styles.th, styles.cTime]}>Out</Text>
            <Text style={[styles.th, styles.cBrk]}>Brk</Text>
            <Text style={[styles.th, styles.cHrs]}>Hrs</Text>
            <Text style={[styles.th, styles.cNum]}>OT</Text>
            <Text style={[styles.th, styles.cNum]}>UT</Text>
            <Text style={[styles.th, styles.cNum]}>ND</Text>
            <Text style={[styles.th, styles.cStatus]}>Status</Text>
          </View>
          {dtr.rows.map((r, i) => (
            <View key={r.ymd} style={[styles.tr, i < dtr.rows.length - 1 && styles.trBorder, rowTint(r.status)]}>
              <Text style={[styles.td, styles.cDate]}>{String(r.day).padStart(2, "0")} {r.weekdayShort}</Text>
              <Text style={[styles.td, styles.cSched]} numberOfLines={1}>{r.scheduleLabel}</Text>
              <Text style={[styles.td, styles.cTime]}>{formatClock(r.timeIn)}</Text>
              <Text style={[styles.td, styles.cTime]}>{formatClock(r.timeOut)}</Text>
              <Text style={[styles.td, styles.cBrk]}>{r.breakMinutes ? formatHours(r.breakMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cHrs]}>{r.workedMinutes ? formatHours(r.workedMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cNum, r.otMinutes ? styles.otText : undefined]}>{r.otMinutes ? formatHours(r.otMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cNum, r.underMinutes ? styles.utText : undefined]}>{r.underMinutes ? formatHours(r.underMinutes) : "—"}</Text>
              <Text style={[styles.td, styles.cNum, r.nightMinutes ? styles.ndText : undefined]}>{r.nightMinutes ? formatHours(r.nightMinutes) : "—"}</Text>
              <View style={styles.cStatus}>
                <Badge label={statusLabel(r)} tone={statusTone(r.status, r.late)} />
              </View>
            </View>
          ))}
        </Card>
      )}

      {!dtr && !loading && (
        <EmptyState icon="file-document-outline" text="Pick an employee and month, then Generate" />
      )}
    </View>
  );
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function rowTint(status: string) {
  if (status === "rest") return { backgroundColor: "#FAFDFB" };
  if (status === "holiday") return { backgroundColor: "#FAF7FF" };
  if (status === "leave") return { backgroundColor: "#F5FBF7" };
  return undefined;
}
function statusTone(status: string, late: boolean): "in" | "warning" | "critical" | "neutral" | "approved" {
  if (status === "absent") return "critical";
  if (status === "leave" || status === "holiday") return "approved";
  if (status === "rest" || status === "upcoming") return "neutral";
  return late ? "warning" : "in";
}

// Build a printable DTR in the Philippine CSC Form No. 48 layout. `rows` null →
// a blank template (31 empty days); otherwise the month's punches are filled in:
// A.M. Arrival = time-in, A.M. Departure = break-out, P.M. Arrival = break-in,
// P.M. Departure = time-out, Undertime split into hours / minutes.
function dtrFormHtml({
  name,
  empId,
  monthLabel,
  rows,
}: {
  name: string;
  empId: string;
  monthLabel: string;
  rows: DtrRow[] | null;
}): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const clk = (d: Date | null) => (d ? formatClock(d) : "");
  const dayCount = rows ? rows.length : 31;
  let body = "";
  for (let i = 0; i < dayCount; i += 1) {
    const r = rows ? rows[i] : null;
    const day = r ? r.day : i + 1;
    const utH = r && r.underMinutes ? String(Math.floor(r.underMinutes / 60)) : "";
    const utM = r && r.underMinutes ? String(r.underMinutes % 60) : "";
    body += `<tr><td class="d">${day}</td><td>${r ? clk(r.timeIn) : ""}</td><td>${r ? clk(r.breakOut) : ""}</td><td>${r ? clk(r.breakIn) : ""}</td><td>${r ? clk(r.timeOut) : ""}</td><td>${utH}</td><td>${utM}</td></tr>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily Time Record</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Georgia, serif; color: #000; margin: 0; }
  .sheet { width: 340px; margin: 0 auto; padding: 8px 0; }
  .civ { font-size: 10px; font-style: italic; }
  h1 { font-size: 15px; text-align: center; letter-spacing: 1px; margin: 6px 0 2px; }
  .rule { text-align: center; font-size: 10px; margin-bottom: 10px; }
  .fld { font-size: 11px; margin: 4px 0; }
  .fld b { display: inline-block; min-width: 150px; border-bottom: 1px solid #000; text-align: center; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #000; font-size: 10px; text-align: center; height: 15px; padding: 0 2px; }
  th { font-weight: normal; }
  td.d { width: 22px; font-weight: bold; }
  .cert { font-size: 9.5px; text-align: justify; margin-top: 12px; line-height: 1.35; }
  .sig { margin-top: 26px; text-align: center; font-size: 10px; }
  .sig .line { border-top: 1px solid #000; margin: 0 24px; padding-top: 2px; }
  .verify { font-size: 9.5px; margin-top: 16px; }
</style></head><body>
  <div class="sheet">
    <div class="civ">Civil Service Form No. 48</div>
    <h1>DAILY TIME RECORD</h1>
    <div class="rule">- - - - - - o0o - - - - - -</div>
    <div class="fld">Name: <b>${esc(name)}${empId ? " · " + esc(empId) : ""}</b></div>
    <div class="fld">For the month of: <b>${esc(monthLabel)}</b></div>
    <div class="fld">Official hours for arrival <b>&nbsp;</b> and departure <b>&nbsp;</b></div>
    <table>
      <thead>
        <tr><th rowspan="2">Day</th><th colspan="2">A.M.</th><th colspan="2">P.M.</th><th colspan="2">Undertime</th></tr>
        <tr><th>Arrival</th><th>Departure</th><th>Arrival</th><th>Departure</th><th>Hours</th><th>Min.</th></tr>
      </thead>
      <tbody>${body}
        <tr><td colspan="5" style="text-align:right;font-weight:bold">TOTAL</td><td></td><td></td></tr>
      </tbody>
    </table>
    <p class="cert">I CERTIFY on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.</p>
    <div class="sig"><div class="line">Signature of Employee</div></div>
    <p class="verify">Verified as to the prescribed office hours:</p>
    <div class="sig"><div class="line">In Charge</div></div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
</body></html>`;
}

function openPrint(html: string) {
  const w = window.open("", "_blank", "width=760,height=920");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

const styles = StyleSheet.create({
  // Raised above `actions` so an open employee dropdown paints over the buttons.
  controls: { flexDirection: "row", alignItems: "flex-start", gap: 14, flexWrap: "wrap", position: "relative", zIndex: 30 },
  empCol: { flexGrow: 1, flexBasis: 260, minWidth: 240 },
  monthCol: { width: 160 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", position: "relative", zIndex: 1 },
  actionsGap: { flexGrow: 1, minWidth: 8 },

  // Cutoff / DTR-lock strip.
  lockStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  lockStripOn: {},
  lockText: { flex: 1, minWidth: 200 },
  lockTitle: { fontSize: 13, fontWeight: "800", color: Colors.textPrimary },
  lockSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  lockNoteCol: { flexBasis: 220, flexGrow: 1, minWidth: 180 },

  // Elevated DTR sheet: edge-to-edge table inside a padding-0 card with a
  // distinct header band.
  sheet: { padding: 0, overflow: "hidden" },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  sheetIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetIdent: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3 },
  sheetMeta: { fontSize: 13, color: Colors.textMuted, marginTop: 3, fontWeight: "600" },
  sheetPeriodPill: {
    backgroundColor: Colors.warmSurfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  sheetPeriod: { fontSize: 11.5, color: Colors.primaryDeep, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  sheetLockPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.warningDeep, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  sheetLockText: { fontSize: 11, color: "#fff", fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },

  // Full-width metrics band: equal cells with hairline dividers.
  statBand: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: Colors.warmSurface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.hairline,
  },
  statCell: { flexGrow: 1, flexBasis: 96, minWidth: 84, paddingHorizontal: 14, paddingVertical: 16, alignItems: "center", gap: 5 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: Colors.hairline },
  statValue: { fontSize: 17, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  statValueStrong: { fontSize: 21, color: Colors.primary },
  statLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: Colors.textFaint, fontWeight: "800" },

  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingVertical: 12, gap: 10 },
  thead: { backgroundColor: Colors.cardSurface, borderBottomWidth: 1, borderBottomColor: Colors.hairline, paddingVertical: 11 },
  trBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  th: { fontSize: 11, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { fontSize: 13.5, color: Colors.textPrimary },
  cDate: { width: 74, fontVariant: ["tabular-nums"], fontWeight: "700" },
  cSched: { flex: 1, minWidth: 0, color: Colors.textMuted },
  cTime: { width: 76, fontVariant: ["tabular-nums"] },
  cBrk: { width: 42, fontVariant: ["tabular-nums"], textAlign: "right", color: Colors.textFaint },
  cHrs: { width: 48, fontVariant: ["tabular-nums"], textAlign: "right", fontWeight: "700" },
  cNum: { width: 42, fontVariant: ["tabular-nums"], textAlign: "right", color: Colors.textFaint },
  otText: { color: Colors.primaryDark, fontWeight: "800" },
  utText: { color: Colors.danger, fontWeight: "800" },
  ndText: { color: "#3B5BDB", fontWeight: "800" },
  cStatus: { width: 116 },
});
