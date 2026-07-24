import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BarChart, BarDatum } from "@/components/manager/BarChart";
import { Badge, Button, Card, EmptyState, InlineMessage, SectionTitle, StatTile, StatTone } from "@/components/manager/ui";
import { WorkforceTab } from "@/components/manager/WorkforceTab";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRecord, getAttendanceSince, subscribeAllTodayAttendance } from "@/lib/attendance";
import { AttendanceAlertSettings, defaultAttendanceAlertSettings, saveAttendanceAlertSettings, sendAttendanceAlertNow, subscribeAttendanceAlertSettings } from "@/lib/attendance-alerts";
import { subscribeAllRequests } from "@/lib/attendance-requests";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { LaborCost, laborCostRatioPct, laborCostTotal, ratioVerdict, setManualRevenue, subscribeLaborCost } from "@/lib/labor-cost";
import { subscribeAllLeaves } from "@/lib/leaves";
import { inScope } from "@/lib/org";
import { PosDaily, subscribePosDaily, sumPos } from "@/lib/pos";
import { Schedule, effectiveShift, emptySchedule, getAllSchedules, shiftBlocks } from "@/lib/schedules";

// Minutes worked on a record, overnight-aware, capped at 16h (forgotten time-out).
function workedMins(r: AttendanceRecord): number {
  if (!r.checkOutAt) return 0;
  let m = Math.round((r.checkOutAt.getTime() - r.checkInAt.getTime()) / 60000);
  if (m < 0) m += 24 * 60;
  return Math.min(Math.max(0, m), 16 * 60);
}
// Is a punch late vs the employee's scheduled start for that day (15-min grace)?
function lateVsSchedule(sched: Schedule, checkIn: Date): boolean {
  const ymd = `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, "0")}-${String(checkIn.getDate()).padStart(2, "0")}`;
  const shift = effectiveShift(sched, ymd);
  if (shift.off) return false;
  const blocks = shiftBlocks(shift);
  if (!blocks.length) return false;
  const [sh, sm] = blocks[0].start.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(sm)) return false;
  return checkIn.getHours() * 60 + checkIn.getMinutes() > sh * 60 + sm + 15;
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function peso(n: number) {
  return "₱" + Math.round(n).toLocaleString("en-PH");
}

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hourLabel(h: number) {
  const period = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function fmtTime(value: Date | null) {
  return value ? value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
}

// Minutes-since-midnight → "7:42 AM". Used for the average time-in insight.
function fmtMinOfDay(m: number | null) {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

// Compact relative time for the activity feed ("just now" / "5m ago" / "2h ago").
function ago(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// The most recent punch event on a record: a time-out if present, else the time-in.
type ActivityEvent = { id: string; name: string; branch: string; kind: "in" | "out"; at: Date };

function toEvent(r: AttendanceRecord): ActivityEvent {
  return r.checkOutAt
    ? { id: r.id + "-out", name: r.employeeName, branch: r.branchName, kind: "out", at: r.checkOutAt }
    : { id: r.id + "-in", name: r.employeeName, branch: r.branchName, kind: "in", at: r.checkInAt };
}

export function DashboardTab({
  managerName,
  pendingCount,
  alarmCount,
  allowed,
  companyId,
  onNavigate,
}: {
  managerName: string;
  pendingCount: number;
  alarmCount: number;
  allowed: Set<string> | null;
  companyId: string | null;
  onNavigate?: (target: "approvals" | "requests" | "devices" | "attendance") => void;
}) {
  const [allRows, setAllRows] = useState<AttendanceRecord[]>([]);
  useEffect(() => subscribeAllTodayAttendance(setAllRows, () => setAllRows([])), []);
  const rows = useMemo(() => allRows.filter((r) => inScope(r.branchId, allowed)), [allRows, allowed]);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  // Last 7 days of punches, fetched once for the trend chart.
  const [week, setWeek] = useState<AttendanceRecord[]>([]);
  useEffect(() => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);
    getAttendanceSince(since.getTime()).then(setWeek).catch(() => setWeek([]));
  }, []);

  // Roster + schedules, for the absent count: active employees whose effective
  // shift today is a work day but who have no punch. Schedules are read once;
  // employees with no saved schedule fall back to the default Mon–Sat week.
  const [roster, setRoster] = useState<EmployeeMaster[]>([]);
  useEffect(() => subscribeEmployeeMasters(setRoster, () => setRoster([])), []);
  // Pending OT/DTR-correction + leave requests, in scope, for the action center.
  const [reqPending, setReqPending] = useState(0);
  const [leavePendingLive, setLeavePendingLive] = useState(0);
  useEffect(
    () => subscribeAllRequests(
      (rs) => setReqPending(rs.filter((r) => r.status === "pending" && inScope(r.branchId, allowed)).length),
      () => setReqPending(0),
    ),
    [allowed],
  );
  useEffect(
    () => subscribeAllLeaves(
      (ls) => setLeavePendingLive(ls.filter((l) => l.status === "pending" && inScope(l.branchId, allowed)).length),
      () => setLeavePendingLive(0),
    ),
    [allowed],
  );
  const [schedules, setSchedules] = useState<Map<string, Schedule>>(new Map());
  useEffect(() => {
    getAllSchedules().then(setSchedules).catch(() => setSchedules(new Map()));
  }, []);

  const alertCompanyId = companyId ?? "";
  const [alertSettings, setAlertSettings] = useState<AttendanceAlertSettings>(() => defaultAttendanceAlertSettings(alertCompanyId));
  const [phoneDraft, setPhoneDraft] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [sendingAlert, setSendingAlert] = useState(false);
  useEffect(() => {
    if (!alertCompanyId) {
      setAlertSettings(defaultAttendanceAlertSettings(""));
      return;
    }
    return subscribeAttendanceAlertSettings(alertCompanyId, setAlertSettings);
  }, [alertCompanyId]);
  const normalizePhone = (raw: string) => {
    let value = raw.replace(/[\s()\-.]/g, "");
    if (/^09\d{9}$/.test(value)) value = `+63${value.slice(1)}`;
    else if (/^639\d{9}$/.test(value)) value = `+${value}`;
    return /^\+639\d{9}$/.test(value) ? value : null;
  };
  const addRecipient = () => {
    const phone = normalizePhone(phoneDraft);
    if (!phone) {
      setAlertMessage("Enter a valid PH mobile number, e.g. 09171234567 or +639171234567.");
      return;
    }
    if (alertSettings.recipientPhones.includes(phone)) {
      setAlertMessage("That number is already in the recipient list.");
      return;
    }
    setAlertSettings((s) => ({ ...s, recipientPhones: [...s.recipientPhones, phone] }));
    setPhoneDraft("");
    setAlertMessage("");
  };
  const removeRecipient = (phone: string) =>
    setAlertSettings((s) => ({ ...s, recipientPhones: s.recipientPhones.filter((p) => p !== phone) }));
  const saveAlerts = async () => {
    try {
      if (!alertCompanyId) {
        setAlertMessage("Select one organization before configuring tenant alerts.");
        return;
      }
      let nextSettings = alertSettings;
      if (phoneDraft.trim()) {
        const phone = normalizePhone(phoneDraft);
        if (!phone) {
          setAlertMessage("Enter a valid PH mobile number, e.g. 09171234567 or +639171234567.");
          return;
        }
        if (!nextSettings.recipientPhones.includes(phone)) {
          nextSettings = { ...nextSettings, recipientPhones: [...nextSettings.recipientPhones, phone] };
          setAlertSettings(nextSettings);
        }
        setPhoneDraft("");
      }
      if (nextSettings.enabled && nextSettings.recipientPhones.length === 0) {
        setAlertMessage("Add at least one SMS recipient before enabling alerts.");
        return;
      }
      await saveAttendanceAlertSettings(nextSettings, managerName);
      setAlertMessage("Attendance SMS alert settings saved.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      setAlertMessage(message.toLowerCase().includes("permission")
        ? "Save blocked by Firebase permissions. Deploy the updated Firestore rules, then try again."
        : "Save failed: " + message);
    }
  };
  const sendNow = async () => {
    if (!confirmSend) {
      setConfirmSend(true);
      setAlertMessage("Press Confirm send to use SMS credits and send the current abnormality report.");
      return;
    }
    if (!alertCompanyId || alertSettings.recipientPhones.length === 0) {
      setAlertMessage("Select an organization and add at least one recipient first.");
      setConfirmSend(false);
      return;
    }
    setSendingAlert(true);
    try {
      await saveAttendanceAlertSettings(alertSettings, managerName);
      const result = await sendAttendanceAlertNow(alertCompanyId);
      setAlertMessage(result.sent > 0
        ? `Sent ${result.sent} SMS${result.sent === 1 ? "" : "s"}${result.abnormalBranches > 0 ? ` · ${result.abnormalBranches} low-attendance branch${result.abnormalBranches === 1 ? "" : "es"}` : " · status report (all branches OK)"}.`
        : "No SMS sent — add a recipient (or all were already notified today).");
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      setAlertMessage(message.toLowerCase().includes("internal")
        ? "Send unavailable: deploy the Firebase SMS Function and configure the Semaphore secret first."
        : "Send failed: " + message);
    } finally {
      setSendingAlert(false);
      setConfirmSend(false);
    }
  };

  const { onShift, onBreak, done, total, events } = useMemo(() => {
    const isOnBreak = (r: AttendanceRecord) => !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
    const onBreak = rows.filter(isOnBreak).length;
    const onShift = rows.filter((r) => !r.checkOutAt && !isOnBreak(r)).length;
    const done = rows.filter((r) => r.checkOutAt).length;
    const ids = new Set(rows.map((r) => r.employeeId));
    const events = rows.map(toEvent).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);
    return { onShift, onBreak, done, total: ids.size, events };
  }, [rows]);

  // Derived operational insights for today (all from data already loaded).
  const insight = useMemo(() => {
    const doneRows = rows.filter((r) => r.checkOutAt && r.totalMinutes);
    const minutes = doneRows.reduce((s, r) => s + (r.totalMinutes ?? 0), 0);
    const branches = new Set(rows.map((r) => r.branchId));
    const ins = rows.map((r) => r.checkInAt.getHours() * 60 + r.checkInAt.getMinutes());
    const avgIn = ins.length ? Math.round(ins.reduce((a, b) => a + b, 0) / ins.length) : null;
    return {
      hoursLogged: minutes / 60,
      shiftsCounted: doneRows.length,
      activeBranches: branches.size,
      avgIn,
      completion: total > 0 ? Math.round((done / total) * 100) : 0,
      onShiftPct: total > 0 ? Math.round((onShift / total) * 100) : 0,
    };
  }, [rows, total, done, onShift]);

  // Absent today: active, in-scope employees scheduled to work today (effective
  // shift not a rest day) who have not punched in.
  const absentEmployees = useMemo(() => {
    const now = new Date();
    const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const present = new Set(rows.map((r) => r.employeeId));
    const employees: EmployeeMaster[] = [];
    for (const e of roster) {
      if (e.status !== "active" || !inScope(e.branchId, allowed)) continue;
      const sched = schedules.get(e.employeeId) ?? emptySchedule(e.employeeId);
      if (!effectiveShift(sched, ymd).off && !present.has(e.employeeId)) employees.push(e);
    }
    return employees.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [roster, schedules, rows, allowed]);
  const absent = absentEmployees.length;

  // ── Step 8: Owner Insight — Labor Cost Ratio (this month) ──
  const insightMonth = currentMonthValue();
  const scopeBranchIds = useMemo(() => {
    const s = new Set<string>();
    roster.forEach((e) => {
      if (e.branchId && inScope(e.branchId, allowed)) s.add(e.branchId);
    });
    return [...s];
  }, [roster, allowed]);

  const [laborCost, setLaborCost] = useState<LaborCost | null>(null);
  useEffect(() => subscribeLaborCost(companyId, insightMonth, setLaborCost, () => setLaborCost(null)), [companyId, insightMonth]);
  const [posRows, setPosRows] = useState<PosDaily[]>([]);
  useEffect(
    () => subscribePosDaily(scopeBranchIds, `${insightMonth}-01`, `${insightMonth}-31`, setPosRows, () => setPosRows([])),
    [scopeBranchIds, insightMonth],
  );
  const [revInput, setRevInput] = useState("");
  const saveRevenue = () => {
    const n = parseFloat(revInput.replace(/[^0-9.]/g, ""));
    setManualRevenue(companyId, insightMonth, Number.isFinite(n) && n > 0 ? n : null);
    setRevInput("");
  };

  const laborTotal = laborCost ? laborCostTotal(laborCost) : 0;
  const posNet = sumPos(posRows).netSales;
  const revenue = laborCost?.manualRevenue != null ? laborCost.manualRevenue : posNet > 0 ? posNet : null;
  const revenueSource: "pos" | "manual" | null =
    laborCost?.manualRevenue != null ? "manual" : posNet > 0 ? "pos" : null;
  const ratioPct = laborTotal > 0 && revenue ? laborCostRatioPct(laborTotal, revenue) : null;
  const verdict = ratioPct != null ? ratioVerdict(ratioPct) : null;

  // Top performers — most hours logged over the last 7 days (from real punches,
  // overnight-aware), days present as the tiebreaker.
  const topPerformers = useMemo(() => {
    const byEmp = new Map<string, { name: string; branch: string; minutes: number; days: Set<string> }>();
    for (const r of week) {
      if (!inScope(r.branchId, allowed) || !r.checkOutAt) continue;
      let mins = Math.round((r.checkOutAt.getTime() - r.checkInAt.getTime()) / 60000);
      if (mins < 0) mins += 24 * 60; // overnight
      mins = Math.min(Math.max(0, mins), 16 * 60);
      const cur = byEmp.get(r.employeeId) ?? { name: r.employeeName, branch: r.branchName, minutes: 0, days: new Set<string>() };
      cur.minutes += mins;
      cur.days.add(`${r.checkInAt.getFullYear()}-${r.checkInAt.getMonth()}-${r.checkInAt.getDate()}`);
      byEmp.set(r.employeeId, cur);
    }
    return [...byEmp.values()]
      .map((e) => ({ name: e.name, branch: e.branch, minutes: e.minutes, days: e.days.size }))
      .sort((a, b) => b.minutes - a.minutes || b.days - a.days)
      .slice(0, 3);
  }, [week, allowed]);

  // Distinct headcount per branch, today — a live breakdown the roster-based
  // Workforce Analytics section below does not show.
  const byBranch = useMemo(() => {
    const m = new Map<string, Set<string>>();
    rows.forEach((r) => {
      const set = m.get(r.branchName) ?? new Set<string>();
      set.add(r.employeeId);
      m.set(r.branchName, set);
    });
    return [...m.entries()]
      .map(([label, set]) => ({ label, value: set.size }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  // ── This Week: totals across the last 7 days of punches ──
  const weekStats = useMemo(() => {
    const inWeek = week.filter((r) => inScope(r.branchId, allowed));
    let minutes = 0;
    let shifts = 0;
    let lates = 0;
    const emps = new Set<string>();
    for (const r of inWeek) {
      emps.add(r.employeeId);
      minutes += workedMins(r);
      if (r.checkOutAt) shifts += 1;
      if (lateVsSchedule(schedules.get(r.employeeId) ?? emptySchedule(r.employeeId), r.checkInAt)) lates += 1;
    }
    return { hours: minutes / 60, shifts, lates, employees: emps.size };
  }, [week, allowed, schedules]);

  // ── Branch comparison: present today + week hours + this month's revenue ──
  const branchStats = useMemo(() => {
    const names = new Map<string, string>();
    const present = new Map<string, Set<string>>();
    rows.forEach((r) => {
      const k = r.branchId || r.branchName;
      names.set(k, r.branchName || k);
      if (!present.has(k)) present.set(k, new Set());
      present.get(k)!.add(r.employeeId);
    });
    const hours = new Map<string, number>();
    week.filter((r) => inScope(r.branchId, allowed)).forEach((r) => {
      const k = r.branchId || r.branchName;
      names.set(k, r.branchName || names.get(k) || k);
      hours.set(k, (hours.get(k) || 0) + workedMins(r));
    });
    const revenue = new Map<string, number>();
    posRows.forEach((p) => revenue.set(p.branchId, (revenue.get(p.branchId) || 0) + p.netSales));
    return [...new Set([...names.keys(), ...revenue.keys()])]
      .map((k) => ({ key: k, name: names.get(k) || k, present: present.get(k)?.size || 0, hours: (hours.get(k) || 0) / 60, revenue: revenue.get(k) || 0 }))
      .sort((a, b) => b.revenue - a.revenue || b.present - a.present);
  }, [rows, week, posRows, allowed]);

  // ── Needs Attention: actionable counts, worst first ──
  const attention = useMemo(
    () =>
      [
        { key: "leaves", target: "approvals" as const, label: "Leave approvals", sub: "awaiting review", count: leavePendingLive || pendingCount, icon: "checkbox-marked-circle-outline" as MdIcon },
        { key: "requests", target: "requests" as const, label: "OT / DTR corrections", sub: "awaiting review", count: reqPending, icon: "clock-edit-outline" as MdIcon },
        { key: "alarms", target: "devices" as const, label: "Device alarms", sub: "unacknowledged", count: alarmCount, icon: "shield-alert-outline" as MdIcon },
        { key: "absent", target: "attendance" as const, label: "Absent today", sub: "scheduled, no time-in", count: absent, icon: "account-alert-outline" as MdIcon },
      ].filter((a) => a.count > 0),
    [leavePendingLive, pendingCount, reqPending, alarmCount, absent],
  );

  // Time-ins bucketed by hour (6am–9pm), from today's punches.
  const hourData: BarDatum[] = useMemo(() => {
    const START = 6;
    const END = 21;
    const counts = new Array(END - START + 1).fill(0);
    rows.forEach((r) => {
      const h = r.checkInAt.getHours();
      if (h >= START && h <= END) counts[h - START] += 1;
    });
    return counts.map((v, i) => ({ label: (START + i) % 3 === 0 ? hourLabel(START + i) : "", value: v }));
  }, [rows]);

  // Distinct headcount per day across the last 7 days.
  const weekData: BarDatum[] = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const days: BarDatum[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const key = dayKey(d);
      const ids = new Set<string>();
      week.forEach((r) => {
        if (dayKey(r.checkInAt) === key && inScope(r.branchId, allowed)) ids.add(r.employeeId);
      });
      days.push({ label: WD_SHORT[d.getDay()], value: ids.size });
    }
    // Keep today's bar live as people clock in after the initial fetch.
    days[6].value = Math.max(days[6].value, total);
    return days;
  }, [week, total, allowed]);

  // Today's headcount vs the prior-6-day average — a small trend signal.
  const statusTotal = onShift + onBreak + done;
  const segments = [
    { key: "shift", label: "On shift", value: onShift, color: Colors.success },
    { key: "break", label: "On break", value: onBreak, color: Colors.warning },
    { key: "out", label: "Timed out", value: done, color: Colors.textFaint },
  ];

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const stats: { key: string; label: string; value: string; sub: string; icon: MdIcon; tone: StatTone; hasDetails?: boolean }[] = [
    { key: "shift", label: "On shift now", value: String(onShift), sub: `${insight.onShiftPct}% of today's ins`, icon: "account-clock", tone: "in", hasDetails: true },
    { key: "break", label: "On break", value: String(onBreak), sub: "on meal break", icon: "silverware-fork-knife", tone: "pending", hasDetails: true },
    { key: "done", label: "Completed shifts", value: String(done), sub: `${insight.completion}% of today's time-ins`, icon: "logout-variant", tone: "out", hasDetails: true },
    { key: "absent", label: "Absent today", value: String(absent), sub: "scheduled, no time-in", icon: "account-alert-outline", tone: "critical", hasDetails: true },
    { key: "hours", label: "Hours logged", value: insight.hoursLogged.toFixed(1), sub: `across ${insight.shiftsCounted} finished shift${insight.shiftsCounted === 1 ? "" : "s"}`, icon: "timer-outline", tone: "neutral", hasDetails: true },
    { key: "branches", label: "Active branches", value: String(insight.activeBranches), sub: "reporting today", icon: "storefront-outline", tone: "in", hasDetails: true },
    { key: "average", label: "Avg time-in", value: fmtMinOfDay(insight.avgIn), sub: "average clock-in", icon: "clock-fast", tone: "neutral" },
    { key: "approvals", label: "Pending approvals", value: String(pendingCount), sub: "awaiting review", icon: "clipboard-text-clock-outline", tone: "pending" },
    { key: "alarms", label: "Open alarms", value: String(alarmCount), sub: "device alerts", icon: "shield-alert-outline", tone: "critical" },
  ];

  type MetricDetail = { id: string; name: string; meta: string; value?: string };
  const metricDetails = useMemo<Record<string, MetricDetail[]>>(() => {
    const isOnBreak = (r: AttendanceRecord) => !r.checkOutAt && !!r.breakOutAt && !r.breakInAt;
    return {
      shift: rows
        .filter((r) => !r.checkOutAt && !isOnBreak(r))
        .map((r) => ({ id: r.id, name: r.employeeName, meta: r.branchName || "Unassigned branch", value: `In ${fmtTime(r.checkInAt)}` })),
      break: rows
        .filter(isOnBreak)
        .map((r) => ({ id: r.id, name: r.employeeName, meta: r.branchName || "Unassigned branch", value: `Since ${fmtTime(r.breakOutAt)}` })),
      done: rows
        .filter((r) => !!r.checkOutAt)
        .map((r) => ({ id: r.id, name: r.employeeName, meta: r.branchName || "Unassigned branch", value: `Out ${fmtTime(r.checkOutAt)}` })),
      absent: absentEmployees.map((e) => ({
        id: e.employeeId,
        name: e.fullName,
        meta: [e.branchName || "Unassigned branch", e.position].filter(Boolean).join(" · "),
      })),
      hours: rows
        .filter((r) => !!r.checkOutAt)
        .map((r) => ({
          id: r.id,
          name: r.employeeName,
          meta: r.branchName || "Unassigned branch",
          value: `${(workedMins(r) / 60).toFixed(1)} h`,
        }))
        .sort((a, b) => parseFloat(b.value) - parseFloat(a.value)),
      branches: byBranch.map((b) => ({
        id: b.label,
        name: b.label,
        meta: `${b.value} employee${b.value === 1 ? "" : "s"} reporting today`,
      })),
    };
  }, [rows, absentEmployees, byBranch]);

  const selectedStat = stats.find((s) => s.key === selectedMetric);
  const selectedDetails = selectedMetric ? metricDetails[selectedMetric] ?? [] : [];

  const branchMax = Math.max(1, ...byBranch.map((b) => b.value));

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.headerAccent} />
        <View style={styles.grow}>
          <Text style={styles.hello}>
            {greeting}, {managerName.split(" ")[0]}
          </Text>
          <Text style={styles.date}>{todayLabel}</Text>
        </View>
      </View>

      {attention.length > 0 && (
        <View style={styles.attentionCard}>
          <View style={styles.attentionHead}>
            <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={Colors.warningDeep} />
            <Text style={styles.attentionTitle}>Needs Attention</Text>
          </View>
          <View style={styles.attentionRow}>
            {attention.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => onNavigate?.(a.target)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${a.label}`}
                style={({ pressed }) => [styles.attentionItem, pressed && styles.attentionItemPressed]}
              >
                <View style={styles.attentionIconWrap}>
                  <MaterialCommunityIcons name={a.icon} size={17} color={Colors.warningDeep} />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.attentionCount}>{a.count}</Text>
                  <Text style={styles.attentionLabel} numberOfLines={1}>{a.label}</Text>
                  <Text style={styles.attentionSub} numberOfLines={1}>{a.sub}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.grid}>
        {stats.map((s) => (
          <StatTile
            key={s.key}
            label={s.label}
            value={s.value}
            sub={s.sub}
            icon={s.icon}
            tone={s.tone}
            selected={selectedMetric === s.key}
            onPress={s.hasDetails ? () => setSelectedMetric((current) => current === s.key ? null : s.key) : undefined}
          />
        ))}
      </View>

      {selectedStat && (
        <View style={styles.metricDetailCard}>
          <View style={styles.metricDetailHead}>
            <View style={styles.grow}>
              <Text style={styles.metricDetailTitle}>{selectedStat.label}</Text>
              <Text style={styles.metricDetailSub}>
                {selectedDetails.length === 0
                  ? "No employees to display"
                  : `${selectedDetails.length} ${selectedMetric === "branches" ? "active branch" : "employee"}${selectedDetails.length === 1 ? "" : "s"}`}
              </Text>
            </View>
            <Pressable
              onPress={() => setSelectedMetric(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close metric details"
              style={styles.metricDetailClose}
            >
              <MaterialCommunityIcons name="close" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>
          {selectedDetails.length === 0 ? (
            <View style={styles.metricDetailEmpty}>
              <MaterialCommunityIcons name="account-check-outline" size={24} color={Colors.textFaint} />
              <Text style={styles.metricDetailEmptyText}>Nothing to show for this status today.</Text>
            </View>
          ) : (
            <View style={styles.metricDetailList}>
              {selectedDetails.map((item) => (
                <View key={item.id} style={styles.metricDetailRow}>
                  <View style={styles.metricAvatar}>
                    <Text style={styles.metricAvatarText}>{initials(item.name)}</Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.metricDetailName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.metricDetailMeta} numberOfLines={1}>{item.meta}</Text>
                  </View>
                  {item.value ? <Text style={styles.metricDetailValue}>{item.value}</Text> : null}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <Card style={styles.weekCard}>
        <View style={styles.weekHead}>
          <MaterialCommunityIcons name="calendar-week" size={16} color={Colors.primary} />
          <Text style={styles.weekTitle}>This Week</Text>
          <Text style={styles.weekSub}>last 7 days</Text>
        </View>
        <View style={styles.weekStatsRow}>
          <WeekStat value={weekStats.hours % 1 === 0 ? String(weekStats.hours) : weekStats.hours.toFixed(1)} unit="h" label="Hours logged" />
          <WeekStat value={String(weekStats.shifts)} label="Shifts done" />
          <WeekStat value={String(weekStats.employees)} label="Active staff" />
          <WeekStat value={String(weekStats.lates)} label="Late arrivals" warn={weekStats.lates > 0} />
        </View>
      </Card>

      {!companyId ? (
        <Card style={styles.alertCard}>
          <Text style={styles.alertTitle}>Attendance abnormality SMS</Text>
          <Text style={styles.alertSub}>Select one organization in the sidebar to configure its recipients and thresholds.</Text>
        </Card>
      ) : (
      <Card style={styles.alertCard}>
        <View style={styles.alertHead}>
          <MaterialCommunityIcons name="message-alert-outline" size={20} color={Colors.primary} />
          <View style={styles.grow}>
            <Text style={styles.alertTitle}>Daily operations SMS</Text>
            <Text style={styles.alertSub}>Semaphore sends a daily digest: attendance vs the minimum present headcount, pending approvals (leave + DTR/OT), and any offline scanner.</Text>
          </View>
          <Pressable
            style={[styles.alertToggle, alertSettings.enabled && styles.alertToggleOn]}
            onPress={() => setAlertSettings((s) => ({ ...s, enabled: !s.enabled }))}
          >
            <Text style={[styles.alertToggleText, alertSettings.enabled && styles.alertToggleTextOn]}>
              {alertSettings.enabled ? "Enabled" : "Disabled"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.alertFields}>
          <View style={styles.alertSmallField}>
            <Text style={styles.alertLabel}>Minimum present / branch</Text>
            <TextInput
              style={styles.alertInput}
              keyboardType="numeric"
              value={String(alertSettings.minPresentPerBranch)}
              onChangeText={(v) => setAlertSettings((s) => ({ ...s, minPresentPerBranch: Math.max(1, Number(v) || 1) }))}
            />
          </View>
          <View style={styles.alertSmallField}>
            <Text style={styles.alertLabel}>Send alert at (24-hour)</Text>
            <TextInput
              style={styles.alertInput}
              keyboardType="numeric"
              value={String(alertSettings.checkHour)}
              onChangeText={(v) => setAlertSettings((s) => ({ ...s, checkHour: Math.min(23, Math.max(0, Number(v) || 0)) }))}
            />
          </View>
          <View style={styles.alertPhoneField}>
            <Text style={styles.alertLabel}>Add SMS recipient</Text>
            <View style={styles.phoneAddRow}>
              <TextInput
                style={[styles.alertInput, styles.phoneInput]}
                value={phoneDraft}
                onChangeText={setPhoneDraft}
                keyboardType="phone-pad"
                placeholder="09171234567"
                placeholderTextColor={Colors.textPlaceholder}
                onSubmitEditing={addRecipient}
              />
              <Button label="Add number" icon="plus" size="sm" variant="ghost" onPress={addRecipient} />
            </View>
          </View>
          <Button label="Save alert" icon="content-save-outline" size="sm" onPress={saveAlerts} />
          <Button
            label={sendingAlert ? "Sending…" : confirmSend ? "Confirm send" : "Send alert now"}
            icon={confirmSend ? "alert-outline" : "send-outline"}
            size="sm"
            variant={confirmSend ? "danger" : "ghost"}
            loading={sendingAlert}
            onPress={sendNow}
          />
        </View>
        <View style={styles.recipientList}>
          {alertSettings.recipientPhones.length === 0 ? (
            <Text style={styles.noRecipients}>No SMS recipients added.</Text>
          ) : alertSettings.recipientPhones.map((phone) => (
            <View key={phone} style={styles.recipientChip}>
              <MaterialCommunityIcons name="cellphone" size={14} color={Colors.primary} />
              <Text style={styles.recipientText}>{phone}</Text>
              <Pressable onPress={() => removeRecipient(phone)} hitSlop={8} accessibilityLabel={`Remove ${phone}`}>
                <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textFaint} />
              </Pressable>
            </View>
          ))}
        </View>
        {alertMessage ? (
          <View style={{ marginTop: 10 }}>
            <InlineMessage
              text={alertMessage}
              tone={
                /fail|unavailable|blocked|before|first|at least|select|enter a valid|no sms/i.test(alertMessage)
                  ? "error"
                  : /sent|saved|✓/i.test(alertMessage)
                    ? "success"
                    : "info"
              }
            />
          </View>
        ) : null}
      </Card>
      )}

      {/* Step 8 — Owner Insight: Labor Cost Ratio */}
      <Card style={styles.insightCard}>
        <View style={styles.insightHead}>
          <MaterialCommunityIcons name="finance" size={18} color={Colors.primary} />
          <Text style={styles.insightTitle}>Owner Insight · Labor Cost Ratio</Text>
          <Text style={styles.insightMonth}>{insightMonth}</Text>
        </View>
        {ratioPct != null ? (
          <View style={styles.insightBody}>
            <View style={styles.ratioBlock}>
              <Text
                style={[
                  styles.ratioValue,
                  { color: verdict === "within" ? Colors.success : verdict === "over" ? Colors.danger : Colors.primaryDark },
                ]}
              >
                {ratioPct.toFixed(1)}%
              </Text>
              <View style={[styles.ratioTag, { backgroundColor: verdict === "within" ? "#E9F6EE" : verdict === "over" ? Colors.dangerTint : Colors.primaryTint }]}>
                <Text style={[styles.ratioTagText, { color: verdict === "within" ? Colors.success : verdict === "over" ? Colors.danger : Colors.primaryDark }]}>
                  {verdict === "within" ? "Within benchmark" : verdict === "over" ? "Above benchmark" : "Below benchmark"}
                </Text>
              </View>
            </View>
            <View style={styles.ratioMeta}>
              <Text style={styles.ratioFormula}>
                (Gross payroll {peso(laborCost?.grossPayroll ?? 0)} + Employer share {peso(laborCost?.employerContributions ?? 0)}) ÷ POS revenue {peso(revenue ?? 0)}
              </Text>
              <Text style={styles.ratioBench}>
                Casual-dining benchmark 18–22% · revenue from {revenueSource === "manual" ? "manual entry" : "POS feed"}
              </Text>
            </View>
          </View>
        ) : laborTotal <= 0 ? (
          <Text style={styles.insightEmpty}>
            No payroll has been released for this month. In Payroll: compute the run, lock its DTR, approve, then release it.
          </Text>
        ) : (
          <View style={styles.insightBody}>
            <Text style={styles.insightEmpty}>
              Labor cost {peso(laborTotal)} is ready. Connect the POS API for live revenue, or enter this month&apos;s revenue:
            </Text>
            <View style={styles.revRow}>
              <TextInput
                style={styles.revInput}
                value={revInput}
                onChangeText={setRevInput}
                keyboardType="numeric"
                placeholder="Monthly POS revenue (₱)"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <Pressable style={styles.revBtn} onPress={saveRevenue}>
                <Text style={styles.revBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Card>

      {topPerformers.length > 0 && (
        <Card style={styles.perfCard}>
          <View style={styles.perfHead}>
            <MaterialCommunityIcons name="trophy-outline" size={18} color={Colors.primary} />
            <Text style={styles.perfTitle}>Top Performers</Text>
            <Text style={styles.perfPeriod}>most hours · last 7 days</Text>
          </View>
          {topPerformers.map((p, i) => (
            <View key={p.name + i} style={[styles.perfRow, i > 0 && styles.perfRowBorder]}>
              <View style={[styles.perfRank, i === 0 ? styles.rankGold : i === 1 ? styles.rankSilver : styles.rankBronze]}>
                <Text style={[styles.perfRankText, i === 0 && styles.rankTextDark]}>{i + 1}</Text>
              </View>
              <View style={styles.perfMain}>
                <Text style={styles.perfName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.perfSub} numberOfLines={1}>
                  {p.branch}{p.branch ? " · " : ""}{p.days} day{p.days === 1 ? "" : "s"} present
                </Text>
              </View>
              <Text style={styles.perfHours}>{Math.floor(p.minutes / 60)}h {p.minutes % 60}m</Text>
            </View>
          ))}
        </Card>
      )}

      {branchStats.length > 0 && (
        <Card style={styles.branchCmpCard}>
          <View style={styles.branchCmpHead}>
            <MaterialCommunityIcons name="store-outline" size={16} color={Colors.primary} />
            <Text style={styles.branchCmpTitle}>Branch Comparison</Text>
            <Text style={styles.branchCmpSub}>present · 7-day hrs · month revenue</Text>
          </View>
          <View style={[styles.branchCmpRow, styles.branchCmpHeadRow]}>
            <Text style={[styles.branchCmpCell, styles.bcName, styles.branchCmpTh]}>Branch</Text>
            <Text style={[styles.branchCmpCell, styles.bcNum, styles.branchCmpTh]}>Present</Text>
            <Text style={[styles.branchCmpCell, styles.bcNum, styles.branchCmpTh]}>7-day hrs</Text>
            <Text style={[styles.branchCmpCell, styles.bcMoney, styles.branchCmpTh]}>Revenue</Text>
          </View>
          {branchStats.map((b, i) => (
            <View key={b.key} style={[styles.branchCmpRow, i < branchStats.length - 1 && styles.branchCmpBorder]}>
              <Text style={[styles.branchCmpCell, styles.bcName]} numberOfLines={1}>{b.name}</Text>
              <Text style={[styles.branchCmpCell, styles.bcNum, b.present === 0 && styles.bcZero]}>{b.present}</Text>
              <Text style={[styles.branchCmpCell, styles.bcNum]}>{b.hours % 1 === 0 ? b.hours : b.hours.toFixed(1)}</Text>
              <Text style={[styles.branchCmpCell, styles.bcMoney]}>{b.revenue > 0 ? peso(b.revenue) : "—"}</Text>
            </View>
          ))}
        </Card>
      )}

      <View style={styles.chartRow}>
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Today&apos;s status</Text>
          <View style={styles.segBar}>
            {statusTotal === 0 ? (
              <View style={[styles.seg, { flexGrow: 1, backgroundColor: Colors.warmSurfaceAlt }]} />
            ) : (
              segments
                .filter((s) => s.value > 0)
                .map((s) => <View key={s.key} style={[styles.seg, { flexGrow: s.value, backgroundColor: s.color }]} />)
            )}
          </View>
          <View style={styles.legend}>
            {segments.map((s) => (
              <View key={s.key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={styles.legendText}>
                  {s.label} <Text style={styles.legendVal}>{s.value}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Headcount · last 7 days</Text>
          <BarChart data={weekData} />
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Time-ins by hour · today</Text>
          <BarChart data={hourData} showValues={false} />
        </View>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Headcount by branch · today</Text>
          {byBranch.length === 0 ? (
            <Text style={styles.branchEmpty}>No branch activity yet</Text>
          ) : (
            <View style={styles.branchList}>
              {byBranch.map((b) => (
                <View key={b.label} style={styles.branchRow}>
                  <Text style={styles.branchName} numberOfLines={1}>
                    {b.label}
                  </Text>
                  <View style={styles.branchTrack}>
                    <View style={[styles.branchFill, { flexGrow: b.value / branchMax }]} />
                    <View style={{ flexGrow: 1 - b.value / branchMax }} />
                  </View>
                  <Text style={styles.branchVal}>{b.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      <SectionTitle>Recent Time In / Out</SectionTitle>
      {events.length === 0 ? (
        <EmptyState icon="clock-outline" text="No clock-ins yet today" />
      ) : (
        <Card style={{ padding: 0 }}>
          {events.map((e, i) => (
            <View key={e.id} style={[styles.row, i < events.length - 1 && styles.rowBorder]}>
              <View style={[styles.avatar, e.kind === "in" ? styles.avatarIn : styles.avatarOut]}>
                <Text style={[styles.avatarText, e.kind === "in" ? styles.avatarTextIn : styles.avatarTextOut]}>
                  {initials(e.name)}
                </Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text style={styles.rowBranch} numberOfLines={1}>
                  {e.branch} · {ago(e.at)}
                </Text>
              </View>
              <Text style={styles.rowTime}>{fmtTime(e.at)}</Text>
              <View style={styles.rowBadge}>
                <Badge label={e.kind === "in" ? "Timed in" : "Timed out"} tone={e.kind === "in" ? "in" : "out"} />
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* ── Workforce analytics (merged from the old Analytics tab) ── */}
      <View style={styles.analyticsHeader}>
        <Text style={styles.analyticsTitle}>Workforce Analytics</Text>
        <Text style={styles.analyticsSub}>Headcount, tenure, leave, and labor-cost overview</Text>
      </View>
      <WorkforceTab allowed={allowed} />
    </View>
  );
}

const cardShadow = {
  shadowColor: "#1F2937",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.045,
  shadowRadius: 10,
  elevation: 1,
} as const;

function WeekStat({ value, unit, label, warn }: { value: string; unit?: string; label: string; warn?: boolean }) {
  return (
    <View style={styles.weekStat}>
      <Text style={[styles.weekStatValue, warn && styles.weekStatWarn]}>
        {value}
        {unit ? <Text style={styles.weekStatUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.weekStatLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Needs Attention
  attentionCard: { backgroundColor: "#FCF3E6", borderWidth: 1, borderColor: "rgba(154,123,63,0.35)", borderRadius: 16, padding: 16, marginBottom: 18 },
  attentionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  attentionTitle: { fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  attentionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  attentionItem: { flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1, flexBasis: 200, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "rgba(0,0,0,0.05)", paddingHorizontal: 12, paddingVertical: 10 },
  attentionItemPressed: { opacity: 0.78, borderColor: Colors.warningBorder },
  attentionIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#FCF3E6", alignItems: "center", justifyContent: "center" },
  attentionCount: { fontSize: 19, fontWeight: "800", color: Colors.warningDeep, letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  attentionLabel: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary, marginTop: -1 },
  attentionSub: { fontSize: 11, color: Colors.textFaint, marginTop: 1 },

  // This Week
  weekCard: { marginBottom: 18 },
  weekHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  weekTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  weekSub: { fontSize: 11, fontWeight: "700", color: Colors.textFaint, textTransform: "uppercase", letterSpacing: 0.4 },
  weekStatsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  weekStat: { flexGrow: 1, flexBasis: 110, minWidth: 96, backgroundColor: Colors.warmSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  weekStatValue: { fontSize: 22, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  weekStatWarn: { color: Colors.warningDeep },
  weekStatUnit: { fontSize: 13, fontWeight: "700", color: Colors.textFaint },
  weekStatLabel: { fontSize: 11, color: Colors.textFaint, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 3 },

  // Branch comparison
  branchCmpCard: { marginBottom: 18 },
  branchCmpHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  branchCmpTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  branchCmpSub: { fontSize: 11, fontWeight: "700", color: Colors.textFaint, textTransform: "uppercase", letterSpacing: 0.4 },
  branchCmpRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 },
  branchCmpHeadRow: { paddingVertical: 6 },
  branchCmpBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  branchCmpTh: { fontSize: 11, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4 },
  branchCmpCell: { fontSize: 13.5, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  bcName: { flex: 1, minWidth: 0, fontWeight: "700" },
  bcNum: { width: 72, textAlign: "right" },
  bcMoney: { width: 110, textAlign: "right", fontWeight: "700" },
  bcZero: { color: Colors.danger, fontWeight: "800" },

  header: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 14,
    marginBottom: 20,
  },
  headerAccent: {
    width: 4,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  hello: { fontSize: 21, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3 },
  date: { fontSize: 13, fontWeight: "600", color: Colors.textFaint, marginTop: 3 },
  analyticsHeader: {
    marginTop: 30,
    marginBottom: 16,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: Colors.hairline,
  },
  analyticsTitle: { fontSize: 17, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3 },
  analyticsSub: { fontSize: 13, fontWeight: "500", color: Colors.textFaint, marginTop: 3 },

  insightCard: { marginBottom: 18 },

  // Top performers
  perfCard: { marginBottom: 18 },
  perfHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  perfTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  perfPeriod: { fontSize: 11, fontWeight: "700", color: Colors.textFaint, textTransform: "uppercase", letterSpacing: 0.4 },
  perfRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  perfRowBorder: { borderTopWidth: 1, borderTopColor: Colors.hairline },
  perfRank: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: Colors.warmSurface },
  rankGold: { backgroundColor: "#F4C542" },
  rankSilver: { backgroundColor: "#D7D7DB" },
  rankBronze: { backgroundColor: "#E0A87A" },
  perfRankText: { fontSize: 13, fontWeight: "800", color: "#fff" },
  rankTextDark: { color: "#5A4A12" },
  perfMain: { flex: 1, minWidth: 0 },
  perfName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  perfSub: { fontSize: 12, color: Colors.textFaint, marginTop: 1 },
  perfHours: { fontSize: 14, fontWeight: "800", color: Colors.primary, fontVariant: ["tabular-nums"] },
  insightHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  insightTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  insightMonth: { fontSize: 12, fontWeight: "800", color: Colors.textFaint, fontVariant: ["tabular-nums"] },
  insightBody: { gap: 12 },
  ratioBlock: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  ratioValue: { fontSize: 40, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  ratioTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  ratioTagText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  ratioMeta: { gap: 4 },
  ratioFormula: { fontSize: 12.5, color: Colors.textMuted, lineHeight: 18 },
  ratioBench: { fontSize: 11.5, color: Colors.textFaint, fontStyle: "italic" },
  insightEmpty: { fontSize: 13, color: Colors.textMuted, lineHeight: 19 },
  revRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  revInput: {
    flexGrow: 1,
    flexBasis: 220,
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.warmSurface,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Colors.textPrimary,
    ...(({ outlineStyle: "none" }) as object),
  },
  revBtn: { height: 44, paddingHorizontal: 20, borderRadius: 11, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  revBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 22 },
  metricDetailCard: {
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.primaryTintStrong,
    borderRadius: 16,
    padding: 16,
    marginTop: -10,
    marginBottom: 22,
    ...cardShadow,
  },
  metricDetailHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  metricDetailTitle: { fontSize: 15, fontWeight: "800", color: Colors.textPrimary },
  metricDetailSub: { fontSize: 12, fontWeight: "600", color: Colors.textMuted, marginTop: 2 },
  metricDetailClose: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.warmSurface,
  },
  metricDetailList: { borderTopWidth: 1, borderTopColor: Colors.hairline },
  metricDetailRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  metricAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryTint,
  },
  metricAvatarText: { fontSize: 11, fontWeight: "800", color: Colors.primaryDeep },
  metricDetailName: { fontSize: 13.5, fontWeight: "700", color: Colors.textPrimary },
  metricDetailMeta: { fontSize: 11.5, fontWeight: "500", color: Colors.textMuted, marginTop: 2 },
  metricDetailValue: { fontSize: 12, fontWeight: "700", color: Colors.textMuted, fontVariant: ["tabular-nums"] },
  metricDetailEmpty: { alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 22, borderTopWidth: 1, borderTopColor: Colors.hairline },
  metricDetailEmptyText: { fontSize: 12.5, fontWeight: "600", color: Colors.textMuted },

  alertCard: { marginBottom: 18 },
  alertHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  alertTitle: { fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  alertSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  alertToggle: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: Colors.warmSurfaceAlt },
  alertToggleOn: { backgroundColor: Colors.successTint },
  alertToggleText: { fontSize: 11, fontWeight: "800", color: Colors.textMuted },
  alertToggleTextOn: { color: Colors.success },
  alertFields: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", gap: 10 },
  alertSmallField: { width: 170 },
  alertPhoneField: { flexGrow: 1, flexBasis: 260 },
  alertLabel: { fontSize: 11, fontWeight: "700", color: Colors.textMuted, marginBottom: 6 },
  alertInput: { height: 40, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, borderRadius: 10, paddingHorizontal: 12, color: Colors.textPrimary, ...(({ outlineStyle: "none" }) as object) },
  phoneAddRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  phoneInput: { flex: 1, minWidth: 160 },
  recipientList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  recipientChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: Colors.primaryTint, borderWidth: 1, borderColor: Colors.warmBorder },
  recipientText: { fontSize: 12, fontWeight: "700", color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  noRecipients: { fontSize: 12, color: Colors.textFaint, fontStyle: "italic" },
  alertMessage: { marginTop: 10, fontSize: 12, fontWeight: "600", color: Colors.primary },

  chartRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 26 },
  chartCard: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 240,
    backgroundColor: Colors.cardSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    ...cardShadow,
  },
  chartTitle: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary, marginBottom: 14 },
  segBar: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", gap: 2, marginBottom: 14 },
  seg: { height: "100%" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 12, color: Colors.textMuted, fontWeight: "600" },
  legendVal: { color: Colors.textPrimary, fontWeight: "800" },

  // Live headcount-by-branch breakdown (horizontal bars).
  branchList: { gap: 11 },
  branchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  branchName: { width: 96, fontSize: 12, fontWeight: "600", color: Colors.textMuted },
  branchTrack: { flex: 1, flexDirection: "row", height: 8, borderRadius: 4, backgroundColor: Colors.warmSurfaceAlt, overflow: "hidden" },
  branchFill: { backgroundColor: Colors.primary, borderRadius: 4 },
  branchVal: { width: 22, textAlign: "right", fontSize: 13, fontWeight: "800", color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  branchEmpty: { fontSize: 13, color: Colors.textFaint, paddingVertical: 20, textAlign: "center" },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  avatarIn: { backgroundColor: Colors.successTint },
  avatarOut: { backgroundColor: Colors.warmSurfaceAlt },
  avatarText: { fontSize: 12, fontWeight: "800" },
  avatarTextIn: { color: Colors.success },
  avatarTextOut: { color: Colors.textMuted },
  grow: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  rowBranch: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  rowTime: { fontSize: 14, color: Colors.textPrimary, fontVariant: ["tabular-nums"] },
  rowBadge: { width: 92, alignItems: "flex-end" },
});
