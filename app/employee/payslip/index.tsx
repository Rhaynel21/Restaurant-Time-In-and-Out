import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { getAttendanceForMonth } from "@/lib/attendance";
import { buildDtr } from "@/lib/dtr";
import { EmployeeMaster, subscribeEmployeeMaster } from "@/lib/hr";
import { loanBalanceAfter, loanDeductionForMonth } from "@/lib/loans";
import { subscribePayrollFormula } from "@/lib/payroll-settings";
import { DEFAULT_FORMULA, PayBasis, PayFormula, PayInputs, Payslip as PayslipData, computePayslip, peso } from "@/lib/ph-payroll";
import { getSchedule } from "@/lib/schedules";

const INK = "#141414";
const GREEN = "#2F6B4F";
const MUTED = "#6B6B6B";
const FAINT = "#A8A8A8";

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function EmployeePayslip() {
  const inset = useResponsiveInset(22);
  const { employee } = useSession();
  const [master, setMaster] = useState<EmployeeMaster | null>(null);
  const [formula, setFormula] = useState<PayFormula>(DEFAULT_FORMULA);
  const [month, setMonth] = useState(ym(new Date()));
  const [slip, setSlip] = useState<PayslipData | null>(null);
  const [loading, setLoading] = useState(true);

  const employeeId = employee?.employeeId ?? "";

  useEffect(() => {
    if (!employeeId) return;
    return subscribeEmployeeMaster(employeeId, setMaster, () => setMaster(null));
  }, [employeeId]);

  useEffect(
    () => subscribePayrollFormula(master?.companyId ?? null, setFormula, () => {}),
    [master?.companyId],
  );

  useEffect(() => {
    let alive = true;
    if (!master) return;
    setLoading(true);
    const [y, mo] = month.split("-").map(Number);
    const pay: PayBasis = {
      type: master.payType,
      dailyRate: master.dailyRate ?? (master.hourlyRate != null ? master.hourlyRate * 8 : 0),
      hourlyRate: master.hourlyRate ?? (master.dailyRate != null ? master.dailyRate / 8 : 0),
    };
    const inputs: PayInputs = {
      allowanceTaxable: master.allowanceTaxable,
      deMinimis: master.deMinimis,
      otherDeductions: [
        { label: "SSS Loan", amount: master.sssLoan },
        { label: "Pag-IBIG Loan", amount: master.pagibigLoan },
        { label: "Cash Advance", amount: master.cashAdvance },
        ...master.loans.map((l) => ({
          label: `${l.label} · bal ${peso(loanBalanceAfter(l, month))}`,
          amount: loanDeductionForMonth(l, month),
        })),
      ],
    };
    (async () => {
      try {
        const [schedule, records] = await Promise.all([
          getSchedule(master.employeeId),
          getAttendanceForMonth(master.employeeId, y, mo - 1),
        ]);
        const s = computePayslip(buildDtr(y, mo - 1, schedule, records), pay, inputs, formula);
        if (alive) setSlip(s);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [master, month, formula]);

  const monthLabel = useMemo(() => {
    const [y, mo] = month.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [month]);

  const shiftMonth = (delta: number) => {
    const [y, mo] = month.split("-").map(Number);
    setMonth(ym(new Date(y, mo - 1 + delta, 1)));
  };

  if (!employee) return <Redirect href="/login" />;

  return (
    <View style={styles.screen}>
      <AmbientTop height={300} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: inset }]} showsVerticalScrollIndicator={false}>
        <View style={styles.brandBar}>
          <BrandTitle size={28} />
        </View>

        <Text style={styles.title}>My Payslip</Text>
        <Text style={styles.sub}>{master ? master.fullName : employee.fullName}</Text>

        {/* Month picker */}
        <View style={styles.monthRow}>
          <Pressable style={styles.monthBtn} onPress={() => shiftMonth(-1)} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={INK} />
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Pressable style={styles.monthBtn} onPress={() => shiftMonth(1)} hitSlop={8}>
            <Ionicons name="chevron-forward" size={20} color={INK} />
          </Pressable>
        </View>

        {loading ? (
          <Text style={styles.note}>Computing…</Text>
        ) : !slip || slip.grossPay <= 0 ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="cash-remove" size={38} color={FAINT} />
            <Text style={styles.emptyText}>No payroll for {monthLabel} yet.</Text>
          </View>
        ) : (
          <>
            {/* Net pay hero */}
            <View style={styles.netCard}>
              <Text style={styles.netLabel}>NET PAY</Text>
              <Text style={styles.netValue}>{peso(slip.netPay)}</Text>
              <Text style={styles.netMeta}>{slip.daysPresent} day{slip.daysPresent === 1 ? "" : "s"} · gross {peso(slip.grossPay)}</Text>
            </View>

            {/* Earnings */}
            <Text style={styles.section}>Earnings</Text>
            <View style={styles.card}>
              <Row label="Basic pay" detail={slip.payType === "hourly" ? `${slip.regularHours} h × ${peso(slip.hourlyRate)}/hr` : `${slip.daysPresent} days × ${peso(slip.dailyRate)}/day`} value={peso(slip.basicPay)} />
              {slip.otPay > 0 && <Row label="Overtime" detail={`${slip.otHours} h × 125%`} value={peso(slip.otPay)} />}
              {slip.nightPay > 0 && <Row label="Night differential" detail={`${slip.nightHours} h × 10%`} value={peso(slip.nightPay)} />}
              {slip.regHolidayPay > 0 && <Row label="Regular holiday" value={peso(slip.regHolidayPay)} />}
              {slip.specialHolidayPay > 0 && <Row label="Special holiday" value={peso(slip.specialHolidayPay)} />}
              {slip.allowanceTaxable > 0 && <Row label="Allowance" value={peso(slip.allowanceTaxable)} />}
              {slip.deMinimis > 0 && <Row label="De-minimis (non-taxable)" value={peso(slip.deMinimis)} />}
              <Row label="Gross Pay" value={peso(slip.grossPay)} strong />
            </View>

            {/* Deductions */}
            <Text style={styles.section}>Deductions</Text>
            <View style={styles.card}>
              <Row label="SSS" value={peso(slip.sssEE)} />
              <Row label="PhilHealth" value={peso(slip.philhealthEE)} />
              <Row label="Pag-IBIG" value={peso(slip.pagibigEE)} />
              <Row label="Withholding tax" value={peso(slip.withholdingTax)} />
              {slip.otherDeductions.map((d) => (
                <Row key={d.label} label={d.label} value={peso(d.amount)} />
              ))}
              <Row label="Total Deductions" value={peso(slip.totalDeductions)} strong />
            </View>

            <View style={styles.hint}>
              <MaterialCommunityIcons name="shield-check-outline" size={15} color={GREEN} />
              <Text style={styles.hintText}>
                Computed from your DTR at {formula.payFrequency === "weekly" ? "weekly" : formula.payFrequency === "semimonthly" ? "semi-monthly" : "monthly"} pay. Statutory rates per the latest tables — for reference; HR&apos;s official payslip prevails.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      <BottomNav active="home" />
    </View>
  );
}

function Row({ label, value, detail, strong }: { label: string; value: string; detail?: string; strong?: boolean }) {
  return (
    <View style={[styles.row, strong && styles.rowStrong]}>
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, strong && styles.rowLabelStrong]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F5F0" },
  scroll: { flex: 1 },
  content: { paddingTop: 56, paddingBottom: 130 },
  brandBar: { marginBottom: 18 },
  title: { fontSize: 28, fontWeight: "800", color: INK, letterSpacing: -0.6 },
  sub: { fontSize: 14, color: MUTED, marginTop: 2, fontWeight: "500" },

  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(10,10,10,0.05)" },
  monthBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 15, fontWeight: "800", color: INK },

  netCard: { marginTop: 18, backgroundColor: INK, borderRadius: 22, padding: 22, alignItems: "center" },
  netLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  netValue: { color: "#fff", fontSize: 38, fontWeight: "800", letterSpacing: -1, marginTop: 6, fontVariant: ["tabular-nums"] },
  netMeta: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 6, fontWeight: "600" },

  section: { fontSize: 12, fontWeight: "800", color: FAINT, textTransform: "uppercase", letterSpacing: 1.2, marginTop: 24, marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "rgba(10,10,10,0.04)" },

  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 7 },
  rowStrong: { borderTopWidth: 1, borderTopColor: "rgba(10,10,10,0.07)", marginTop: 5, paddingTop: 10 },
  rowLabelWrap: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 14, color: "#2A2A2A" },
  rowLabelStrong: { fontWeight: "800", color: INK },
  rowDetail: { fontSize: 11, color: FAINT, marginTop: 1 },
  rowValue: { fontSize: 14, color: INK, fontVariant: ["tabular-nums"] },
  rowValueStrong: { fontWeight: "800" },

  emptyCard: { marginTop: 18, backgroundColor: "#fff", borderRadius: 18, paddingVertical: 40, alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(10,10,10,0.04)" },
  emptyText: { color: MUTED, fontSize: 14, fontWeight: "500" },
  note: { marginTop: 20, color: MUTED, fontSize: 14, textAlign: "center" },

  hint: { marginTop: 18, flexDirection: "row", gap: 8, alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: "rgba(47,107,79,0.06)", borderWidth: 1, borderColor: "rgba(47,107,79,0.15)" },
  hintText: { flex: 1, fontSize: 12, color: "#4A5A50", lineHeight: 17, fontWeight: "500" },
});
