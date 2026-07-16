import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { ApprovalsTab } from "@/components/manager/ApprovalsTab";
import { AttendanceTab } from "@/components/manager/AttendanceTab";
import { DashboardTab } from "@/components/manager/DashboardTab";
import { DevicesTab } from "@/components/manager/DevicesTab";
import { DocumentsTab } from "@/components/manager/DocumentsTab";
import { DtrTab } from "@/components/manager/DtrTab";
import { EmployeesTab } from "@/components/manager/EmployeesTab";
import { FinalPayTab } from "@/components/manager/FinalPayTab";
import { LeavesTab } from "@/components/manager/LeavesTab";
import { MemoTab } from "@/components/manager/MemoTab";
import { OrgTab } from "@/components/manager/OrgTab";
import { PayrollTab } from "@/components/manager/PayrollTab";
import { SchedulesTab } from "@/components/manager/SchedulesTab";
import { ManagerColors as Colors } from "@/constants/theme";
import { useSession } from "@/contexts/session-context";
import { signOutUser } from "@/lib/auth";
import { subscribeAlarms } from "@/lib/devices";
import { subscribePendingLeaves } from "@/lib/leaves";
import { OrgTree, allowedBranchIds, resolveScope, subscribeOrgTree } from "@/lib/org";

type TabKey = "dashboard" | "attendance" | "dtr" | "schedules" | "employees" | "memo" | "org" | "payroll" | "finalpay" | "documents" | "approvals" | "leaves" | "devices";
type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const TABS: { key: TabKey; label: string; icon: MdIcon; title: string; subtitle: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "view-dashboard-outline", title: "Dashboard", subtitle: "Today's time in & out at a glance" },
  { key: "attendance", label: "Attendance", icon: "clock-outline", title: "Attendance", subtitle: "Today's time in & out across all branches" },
  { key: "dtr", label: "DTR", icon: "file-document-outline", title: "Daily Time Record", subtitle: "Generate and export a monthly DTR" },
  { key: "schedules", label: "Schedules", icon: "calendar-month-outline", title: "Schedules", subtitle: "Set each employee's weekly shifts and date overrides" },
  { key: "employees", label: "Employees", icon: "account-group-outline", title: "Employees", subtitle: "Employee 201 records — add, edit, and manage staff" },
  { key: "memo", label: "Memo", icon: "email-outline", title: "Memo", subtitle: "Compose and send memos to employees" },
  { key: "org", label: "Org", icon: "sitemap-outline", title: "Organization", subtitle: "Departments and branches at a glance" },
  { key: "payroll", label: "Payroll", icon: "cash-multiple", title: "Payroll", subtitle: "Compute monthly gross pay from DTR hours and rates" },
  { key: "finalpay", label: "Final Pay", icon: "account-cash-outline", title: "Final Pay & BIR 2316", subtitle: "Separation pay, pro-rated 13th month, SIL conversion, and BIR Form 2316" },
  { key: "documents", label: "Documents", icon: "folder-account-outline", title: "Documents", subtitle: "Upload and manage each employee's 201 files" },
  { key: "approvals", label: "Approvals", icon: "checkbox-marked-circle-outline", title: "Approvals", subtitle: "Pending leave requests awaiting your review" },
  { key: "leaves", label: "Leaves", icon: "airplane", title: "Leaves", subtitle: "Every leave request, any status" },
  { key: "devices", label: "Devices", icon: "fingerprint", title: "Devices", subtitle: "Biometric terminals and tamper / security alarms" },
];

// Sidebar sections — group the 11 tabs so the nav reads as a hierarchy, not a
// flat list. (Mobile keeps a single horizontal scroll.)
const NAV_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "", keys: ["dashboard"] },
  { label: "Time & Attendance", keys: ["attendance", "dtr", "schedules"] },
  { label: "People", keys: ["employees", "memo", "org", "payroll", "finalpay", "documents"] },
  { label: "Leave", keys: ["approvals", "leaves"] },
  { label: "System", keys: ["devices"] },
];

export default function ManagerPortal() {
  const router = useRouter();
  const { employee, setEmployee } = useSession();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [pendingCount, setPendingCount] = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);
  const [org, setOrg] = useState<OrgTree>({ companies: [], brands: [], branches: [] });

  useEffect(() => subscribePendingLeaves((l) => setPendingCount(l.length), () => setPendingCount(0)), []);
  useEffect(
    () => subscribeAlarms((a) => setAlarmCount(a.filter((x) => !x.acknowledged).length), () => setAlarmCount(0)),
    [],
  );
  useEffect(() => subscribeOrgTree(setOrg, () => setOrg({ companies: [], brands: [], branches: [] })), []);

  if (!employee) return <Redirect href="/login" />;
  if (employee.accessRole === "staff") return <Redirect href="/employee/dashboard" />;

  const wide = width >= 860;

  // Org scope: what this user may see (owner → all, admin → their company's
  // branches, manager → their branch). `allowed` is a branch-id set or null (all).
  const scope = resolveScope(employee);
  const allowed = allowedBranchIds(scope, org.branches);
  const canManageOrg = employee.accessRole === "owner" || employee.accessRole === "admin";

  const initials = employee.fullName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const logout = async () => {
    try {
      await signOutUser();
    } catch {
      // ignore
    }
    setEmployee(null);
    router.replace("/login");
  };

  const badgeFor = (key: TabKey) =>
    key === "approvals" ? pendingCount : key === "devices" ? alarmCount : 0;

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  const content = (
    <>
      {tab === "dashboard" && (
        <DashboardTab managerName={employee.fullName} pendingCount={pendingCount} alarmCount={alarmCount} allowed={allowed} />
      )}
      {tab === "approvals" && <ApprovalsTab reviewerName={employee.fullName} />}
      {tab === "attendance" && <AttendanceTab allowed={allowed} />}
      {tab === "schedules" && <SchedulesTab managerName={employee.fullName} allowed={allowed} />}
      {tab === "employees" && <EmployeesTab managerName={employee.fullName} scope={scope} />}
      {tab === "memo" && <MemoTab managerName={employee.fullName} allowed={allowed} />}
      {tab === "org" && <OrgTab />}
      {tab === "payroll" && <PayrollTab allowed={allowed} />}
      {tab === "finalpay" && <FinalPayTab allowed={allowed} />}
      {tab === "documents" && <DocumentsTab managerName={employee.fullName} allowed={allowed} />}
      {tab === "dtr" && <DtrTab allowed={allowed} />}
      {tab === "devices" && <DevicesTab />}
      {tab === "leaves" && <LeavesTab allowed={allowed} />}
    </>
  );

  // ── Nav buttons ──
  const renderNavButton = (t: (typeof TABS)[number]) => {
    const isActive = t.key === tab;
    const count = badgeFor(t.key);
    return (
      <Pressable
        key={t.key}
        style={[wide ? styles.navBtn : styles.navBtnRow, isActive && (wide ? styles.navBtnActive : styles.navBtnRowActive)]}
        onPress={() => setTab(t.key)}
      >
        <MaterialCommunityIcons
          name={t.icon}
          size={19}
          color={isActive ? Colors.primary : "rgba(247,245,240,0.7)"}
        />
        <Text style={[styles.navText, isActive && styles.navTextActive]}>{t.label}</Text>
        {count > 0 && (
          <View style={[styles.count, isActive && styles.countActive]}>
            <Text style={[styles.countText, isActive && styles.countTextActive]}>{count}</Text>
          </View>
        )}
      </Pressable>
    );
  };
  const isTabVisible = (key: TabKey) => key !== "org" || canManageOrg;
  const flatNav = TABS.filter((t) => isTabVisible(t.key)).map(renderNavButton);

  const userBlock = (
    <View style={styles.sideUser}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {employee.fullName}
        </Text>
        <Text style={styles.role} numberOfLines={1}>
          {employee.role} · {employee.accessRole}
        </Text>
      </View>
      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );

  if (wide) {
    return (
      <View style={styles.screenRow}>
        <LinearGradient
          colors={["#5E6F3F", "#4F5D3A"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.sidebar}
        >
          <View style={styles.brand}>
            <Image
              source={require("../../assets/images/qui-logo-light.png")}
              style={styles.brandLogo}
              resizeMode="contain"
            />
            <Text style={styles.brandSub}>Manager Portal</Text>
          </View>
          <ScrollView style={styles.nav} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
            {NAV_GROUPS.map((g, gi) => (
              <View key={gi} style={gi > 0 ? styles.navGroup : undefined}>
                {g.label ? <Text style={styles.navGroupLabel}>{g.label}</Text> : null}
                {g.keys.filter(isTabVisible).map((k) => renderNavButton(TABS.find((t) => t.key === k)!))}
              </View>
            ))}
          </ScrollView>
          {userBlock}
        </LinearGradient>
        <View style={styles.main}>
          <View style={styles.topbar}>
            <Text style={styles.topTitle}>{active.title}</Text>
            <Text style={styles.topSub}>{active.subtitle}</Text>
          </View>
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            {content}
            <Text style={styles.footer}>Qui · Manager Portal · real-time via Firestore</Text>
          </ScrollView>
        </View>
      </View>
    );
  }

  // ── Narrow / mobile: dark bar + horizontal nav ──
  return (
    <View style={styles.screen}>
      <View style={styles.mobileBar}>
        <View style={styles.mobileBrand}>
          <Image
            source={require("../../assets/images/qui-logo-light.png")}
            style={styles.mobileLogo}
            resizeMode="contain"
          />
          <Text style={styles.mobileSub}>Manager Portal</Text>
        </View>
        <Pressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>
      <View style={styles.mobileNavWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileNav}>
          {flatNav}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.mobileHead}>
          <Text style={styles.topTitle}>{active.title}</Text>
          <Text style={styles.topSub}>{active.subtitle}</Text>
        </View>
        {content}
        <Text style={styles.footer}>Qui · Manager Portal · real-time via Firestore</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  screenRow: { flex: 1, flexDirection: "row", backgroundColor: Colors.background },

  // Sidebar
  sidebar: {
    width: 256,
    backgroundColor: Colors.darkSurface,
    flexDirection: "column",
  },
  brand: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(247,245,240,0.08)",
  },
  brandLogo: {
    width: 96,
    height: 89, // source aspect 1000×929
  },
  brandSub: {
    marginTop: 6,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: "rgba(247,245,240,0.5)",
    fontFamily: "Georgia",
  },
  nav: { flex: 1 },
  navContent: { padding: 12 },
  navGroup: { marginTop: 16, gap: 2 },
  navGroupLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "rgba(247,245,240,0.38)",
    marginBottom: 6,
    marginLeft: 14,
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 11,
  },
  navBtnActive: { backgroundColor: Colors.textOnDark },
  navText: { fontSize: 14, fontWeight: "600", color: "rgba(247,245,240,0.68)" },
  navTextActive: { color: Colors.primary },
  count: {
    marginLeft: "auto",
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  countActive: { backgroundColor: Colors.primary },
  countText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  countTextActive: { color: Colors.textOnDark },

  sideUser: {
    borderTopWidth: 1,
    borderTopColor: "rgba(247,245,240,0.1)",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(247,245,240,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: Colors.textOnDark, fontWeight: "700", fontSize: 14 },
  grow: { flex: 1, minWidth: 0 },
  name: { color: Colors.textOnDark, fontWeight: "700", fontSize: 14 },
  role: { color: "rgba(247,245,240,0.5)", fontSize: 11, marginTop: 1, textTransform: "capitalize" },
  logout: {
    backgroundColor: "rgba(247,245,240,0.1)",
    borderWidth: 1,
    borderColor: "rgba(247,245,240,0.18)",
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  logoutText: { color: Colors.textOnDark, fontWeight: "600", fontSize: 12 },

  // Main column
  main: { flex: 1, minWidth: 0 },
  topbar: {
    backgroundColor: Colors.cardSurface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
    paddingHorizontal: 36,
    paddingVertical: 22,
  },
  topTitle: { fontSize: 21, fontWeight: "700", color: Colors.textPrimary, letterSpacing: -0.2 },
  topSub: { marginTop: 4, fontSize: 13, color: Colors.textSubtle },
  container: { maxWidth: 1040, width: "100%", paddingHorizontal: 36, paddingTop: 28, paddingBottom: 60 },
  footer: { textAlign: "center", color: Colors.textFaint, fontSize: 12, marginTop: 30 },

  // Mobile
  mobileBar: {
    backgroundColor: Colors.darkSurface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mobileBrand: {},
  mobileLogo: { width: 92, height: 85 },
  mobileSub: { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(247,245,240,0.5)", marginTop: 2 },
  mobileNavWrap: { backgroundColor: Colors.darkSurface, borderTopWidth: 1, borderTopColor: "rgba(247,245,240,0.08)" },
  mobileNav: { flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingBottom: 12 },
  navBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
  },
  navBtnRowActive: { backgroundColor: Colors.textOnDark },
  mobileHead: { marginBottom: 18 },
});
