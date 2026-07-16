import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { ApprovalsTab } from "@/components/manager/ApprovalsTab";
import { AttendanceTab } from "@/components/manager/AttendanceTab";
import { AuditTab } from "@/components/manager/AuditTab";
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
import { PerformanceTab } from "@/components/manager/PerformanceTab";
import { RecruitmentTab } from "@/components/manager/RecruitmentTab";
import { RequestsTab } from "@/components/manager/RequestsTab";
import { SchedulesTab } from "@/components/manager/SchedulesTab";
import { ManagerColors as Colors } from "@/constants/theme";
import { useSession } from "@/contexts/session-context";
import { signOutUser } from "@/lib/auth";
import { subscribePendingRequests } from "@/lib/attendance-requests";
import { subscribeAlarms } from "@/lib/devices";
import { subscribePendingLeaves } from "@/lib/leaves";
import { OrgTree, allowedBranchIds, resolveScope, subscribeOrgTree } from "@/lib/org";

type TabKey = "dashboard" | "attendance" | "dtr" | "schedules" | "employees" | "memo" | "org" | "payroll" | "finalpay" | "documents" | "approvals" | "leaves" | "requests" | "recruitment" | "performance" | "devices" | "audit";
type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const TABS: { key: TabKey; label: string; icon: MdIcon; title: string; subtitle: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "view-dashboard-outline", title: "Dashboard", subtitle: "Today's operations and workforce analytics at a glance" },
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
  { key: "requests", label: "OT / Corrections", icon: "clock-edit-outline", title: "OT & DTR Requests", subtitle: "Approve overtime filings and DTR corrections" },
  { key: "recruitment", label: "Recruitment", icon: "briefcase-search-outline", title: "Recruitment", subtitle: "Job posts and applicant hiring pipeline" },
  { key: "performance", label: "Performance", icon: "star-outline", title: "Performance Management", subtitle: "Appraisals, KPIs, and disciplinary records" },
  { key: "devices", label: "Devices", icon: "fingerprint", title: "Devices", subtitle: "Biometric terminals and tamper / security alarms" },
  { key: "audit", label: "Audit Log", icon: "history", title: "Audit Log", subtitle: "Who changed what, and when (record edits, payroll, approvals)" },
];

// Sidebar sections — group the 11 tabs so the nav reads as a hierarchy, not a
// flat list. (Mobile keeps a single horizontal scroll.)
const NAV_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "", keys: ["dashboard"] },
  { label: "Time & Attendance", keys: ["attendance", "dtr", "schedules"] },
  { label: "Payroll & Compensation", keys: ["payroll", "finalpay"] },
  { label: "People", keys: ["employees", "org", "documents"] },
  { label: "Talent", keys: ["recruitment", "performance"] },
  { label: "Leave", keys: ["approvals", "leaves", "requests"] },
  { label: "Communication", keys: ["memo"] },
  { label: "System", keys: ["devices", "audit"] },
];

// ── Tab visibility per role ───────────────────────────────────────────────
//   • Branch manager (`manager`) → ONE branch. Operations: time & attendance,
//     schedules, their people, leave/OT approvals, recruitment & performance
//     for their staff. NOT payroll, 201 documents, org, devices, or audit.
//   • Area manager (`areaManager`) → SEVERAL branches (a region). Same tabs as a
//     branch manager, just a wider scope. Payroll/201 docs stay with HR
//     (segregation of duties: whoever approves OT must not also run payroll).
//   • HR (`hr`) → everything a branch manager sees, PLUS payroll, final pay, and
//     201 documents (company-wide). NOT org, devices, or audit.
//   • Owner / Admin → everything, including org structure, devices, audit.
const MANAGER_TABS: TabKey[] = [
  "dashboard", "attendance", "dtr", "schedules",
  "employees", "memo", "approvals", "leaves", "requests",
  "recruitment", "performance",
];
const HR_TABS: TabKey[] = [...MANAGER_TABS, "documents", "payroll", "finalpay"];
const ADMIN_TABS: TabKey[] = [...HR_TABS, "org", "devices", "audit"];

function tabsForRole(role: string): Set<TabKey> {
  if (role === "owner" || role === "admin") return new Set(ADMIN_TABS);
  if (role === "hr") return new Set(HR_TABS);
  return new Set(MANAGER_TABS); // manager (branch) + areaManager (region)
}

export default function ManagerPortal() {
  const router = useRouter();
  const { employee, setEmployee } = useSession();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [pendingCount, setPendingCount] = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);
  const [reqCount, setReqCount] = useState(0);
  const [org, setOrg] = useState<OrgTree>({ companies: [], brands: [], branches: [] });
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [openSel, setOpenSel] = useState<null | "brand" | "branch">(null);

  useEffect(() => subscribePendingLeaves((l) => setPendingCount(l.length), () => setPendingCount(0)), []);
  useEffect(
    () => subscribeAlarms((a) => setAlarmCount(a.filter((x) => !x.acknowledged).length), () => setAlarmCount(0)),
    [],
  );
  useEffect(() => subscribeOrgTree(setOrg, () => setOrg({ companies: [], brands: [], branches: [] })), []);
  useEffect(() => subscribePendingRequests((r) => setReqCount(r.length), () => setReqCount(0)), []);

  if (!employee) return <Redirect href="/login" />;
  if (employee.accessRole === "staff") return <Redirect href="/employee/dashboard" />;

  const wide = width >= 860;

  // Org scope: what this user may see (owner → all, admin → their company's
  // branches, manager → their branch). `allowed` is a branch-id set or null (all).
  const scope = resolveScope(employee);
  const baseAllowed = allowedBranchIds(scope, org.branches);

  // Multi-tenant context picker: within what this user's role allows, let them
  // narrow the whole portal to one brand and/or one branch.
  const visibleBranches = org.branches.filter((b) => baseAllowed === null || baseAllowed.has(b.id));
  const visibleBrands = org.brands.filter((br) => visibleBranches.some((b) => b.brandId === br.id));
  const branchOptions = brandFilter ? visibleBranches.filter((b) => b.brandId === brandFilter) : visibleBranches;
  let scopedBranches = visibleBranches;
  if (brandFilter) scopedBranches = scopedBranches.filter((b) => b.brandId === brandFilter);
  if (branchFilter) scopedBranches = scopedBranches.filter((b) => b.id === branchFilter);
  const allowed = baseAllowed === null && !brandFilter && !branchFilter ? null : new Set(scopedBranches.map((b) => b.id));

  const companyName = scope.companyId
    ? org.companies.find((c) => c.id === scope.companyId)?.name ?? "Organization"
    : org.companies.length === 1
      ? org.companies[0].name
      : "All Organizations";
  const companyInitial = (companyName.trim()[0] ?? "•").toUpperCase();
  const brandLabel = brandFilter ? visibleBrands.find((b) => b.id === brandFilter)?.name ?? "Brand" : "All Brands";
  const branchLabel = branchFilter ? branchOptions.find((b) => b.id === branchFilter)?.name ?? "Branch" : "All Branches";

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
    key === "approvals" ? pendingCount : key === "requests" ? reqCount : key === "devices" ? alarmCount : 0;

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
      {tab === "payroll" && <PayrollTab allowed={allowed} companyId={scope.companyId} managerName={employee.fullName} />}
      {tab === "finalpay" && <FinalPayTab allowed={allowed} companyId={scope.companyId} />}
      {tab === "documents" && <DocumentsTab managerName={employee.fullName} allowed={allowed} />}
      {tab === "dtr" && <DtrTab allowed={allowed} />}
      {tab === "devices" && <DevicesTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "leaves" && <LeavesTab allowed={allowed} />}
      {tab === "requests" && <RequestsTab reviewerName={employee.fullName} allowed={allowed} />}
      {tab === "recruitment" && <RecruitmentTab />}
      {tab === "performance" && <PerformanceTab managerName={employee.fullName} />}
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
          color={isActive ? Colors.primary : "rgba(247,245,240,0.82)"}
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
  const visibleTabs = tabsForRole(employee.accessRole);
  const isTabVisible = (key: TabKey) => visibleTabs.has(key);
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
          <View style={styles.orgCard}>
            <View style={styles.orgAvatar}>
              <Text style={styles.orgAvatarText}>{companyInitial}</Text>
            </View>
            <Text style={styles.orgName} numberOfLines={3}>{companyName}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{employee.accessRole}</Text>
            </View>

            {visibleBrands.length > 0 && (
              <>
                <Text style={styles.selLabel}>Brand</Text>
                <SidebarSelect
                  label={brandLabel}
                  open={openSel === "brand"}
                  onToggle={() => setOpenSel(openSel === "brand" ? null : "brand")}
                  selected={brandFilter}
                  options={[{ id: null, name: "All Brands" }, ...visibleBrands.map((b) => ({ id: b.id, name: b.name }))]}
                  onSelect={(id) => {
                    setBrandFilter(id);
                    setBranchFilter(null);
                    setOpenSel(null);
                  }}
                />
              </>
            )}

            <Text style={styles.selLabel}>Branch</Text>
            <SidebarSelect
              label={branchLabel}
              open={openSel === "branch"}
              onToggle={() => setOpenSel(openSel === "branch" ? null : "branch")}
              selected={branchFilter}
              options={[{ id: null, name: "All Branches" }, ...branchOptions.map((b) => ({ id: b.id, name: b.name }))]}
              onSelect={(id) => {
                setBranchFilter(id);
                setOpenSel(null);
              }}
            />
          </View>

          <ScrollView style={styles.nav} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
            {NAV_GROUPS.map((g, gi) => {
              const keys = g.keys.filter(isTabVisible);
              if (keys.length === 0) return null;
              return (
                <View key={gi} style={gi > 0 ? styles.navGroup : undefined}>
                  {g.label ? <Text style={styles.navGroupLabel}>{g.label}</Text> : null}
                  {keys.map((k) => renderNavButton(TABS.find((t) => t.key === k)!))}
                </View>
              );
            })}
          </ScrollView>
          {userBlock}
        </LinearGradient>
        <View style={styles.main}>
          <View style={styles.topbar}>
            <View style={styles.topIcon}>
              <MaterialCommunityIcons name={active.icon} size={22} color={Colors.primary} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.topTitle}>{active.title}</Text>
              <Text style={styles.topSub}>{active.subtitle}</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            {content}
            <Text style={styles.footer}>Qui · real-time via Firestore</Text>
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
          <Text style={styles.mobileTitle}>{companyName}</Text>
          <Text style={styles.mobileRole}>{employee.accessRole}</Text>
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
        <Text style={styles.footer}>Qui · real-time via Firestore</Text>
      </ScrollView>
    </View>
  );
}

// Compact sidebar dropdown for the brand / branch context pickers.
function SidebarSelect({
  label,
  open,
  onToggle,
  options,
  selected,
  onSelect,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  options: { id: string | null; name: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <View style={[styles.selWrap, open && styles.selWrapOpen]}>
      <Pressable style={styles.selBtn} onPress={onToggle}>
        <Text style={styles.selValue} numberOfLines={1}>{label}</Text>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={18} color="rgba(247,245,240,0.7)" />
      </Pressable>
      {open && (
        <View style={styles.selMenu}>
          {options.map((o) => (
            <Pressable key={o.id ?? "all"} style={styles.selItem} onPress={() => onSelect(o.id)}>
              <Text style={[styles.selItemText, o.id === selected && styles.selItemTextOn]} numberOfLines={1}>
                {o.name}
              </Text>
              {o.id === selected && <MaterialCommunityIcons name="check" size={15} color={Colors.textOnDark} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  orgCard: {
    marginHorizontal: 14,
    marginTop: 18,
    marginBottom: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(247,245,240,0.18)",
    backgroundColor: "rgba(247,245,240,0.06)",
    zIndex: 20,
  },
  orgAvatar: { width: 56, height: 56, borderRadius: 15, backgroundColor: "rgba(247,245,240,0.16)", alignItems: "center", justifyContent: "center", alignSelf: "center" },
  orgAvatarText: { color: Colors.textOnDark, fontWeight: "800", fontSize: 22 },
  orgName: { color: Colors.textOnDark, fontWeight: "800", fontSize: 17, letterSpacing: -0.3, textAlign: "center", marginTop: 10, lineHeight: 21 },
  roleBadge: { alignSelf: "center", marginTop: 8, marginBottom: 2, backgroundColor: "rgba(247,245,240,0.16)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 },
  roleBadgeText: { color: Colors.textOnDark, fontSize: 11, fontWeight: "700", textTransform: "capitalize", letterSpacing: 0.3 },
  selLabel: { color: "rgba(247,245,240,0.55)", fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginTop: 12, marginBottom: 5, marginLeft: 2 },
  selWrap: { position: "relative" },
  // Lift the open selector (and its absolute menu) above the branch picker + nav.
  selWrapOpen: { zIndex: 200 },
  selBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: "rgba(247,245,240,0.1)", borderWidth: 1, borderColor: "rgba(247,245,240,0.18)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  selValue: { color: Colors.textOnDark, fontWeight: "700", fontSize: 13, flex: 1 },
  // Absolute overlay so opening the dropdown floats over the nav instead of
  // pushing it down. Opaque so nav text doesn't bleed through.
  selMenu: {
    position: "absolute",
    top: 46,
    left: 0,
    right: 0,
    backgroundColor: "#28331C",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(247,245,240,0.18)",
    paddingVertical: 4,
    zIndex: 200,
    maxHeight: 260,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 16,
  },
  selItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  selItemText: { color: "rgba(247,245,240,0.82)", fontSize: 13, fontWeight: "600", flex: 1 },
  selItemTextOn: { color: Colors.textOnDark, fontWeight: "800" },

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
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "rgba(247,245,240,0.55)",
    marginBottom: 7,
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
  navText: { fontSize: 14, fontWeight: "600", color: "rgba(247,245,240,0.85)" },
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
    paddingVertical: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  topIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: Colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  crumb: { fontSize: 10, fontWeight: "800", color: Colors.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 },
  topTitle: { fontSize: 22, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.4 },
  topSub: { marginTop: 3, fontSize: 13, color: Colors.textSubtle },
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
  mobileTitle: { color: Colors.textOnDark, fontWeight: "800", fontSize: 18, letterSpacing: -0.2 },
  mobileRole: { color: "rgba(247,245,240,0.6)", fontSize: 11, fontWeight: "700", textTransform: "capitalize", marginTop: 1 },
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
