import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  BackLink,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  InlineMessage,
  SearchInput,
  SectionTitle,
  Select,
  SegmentedControl,
  TextField,
} from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AccessRole } from "@/lib/auth";
import { EmployeeMaster, WORKER_TYPES, blankEmployee, deleteEmployee, saveEmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { LOAN_TYPES, Loan, loanBalanceAfter, loanTypeLabel } from "@/lib/loans";
import { EMPTY_ORG, OrgTree, Scope, subscribeOrgTree } from "@/lib/org";
import { peso } from "@/lib/ph-payroll";

const ACCESS_ROLES: AccessRole[] = ["owner", "admin", "hr", "areaManager", "manager", "staff"];

function thisMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function emptyLoan(): Loan {
  return { type: "sss", label: "", principal: 0, monthlyAmortization: 0, startMonth: thisMonthValue() };
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

// Directory table columns (toggleable via "View"). `text` feeds the Excel export.
type ColKey =
  | "firstName" | "lastName" | "email" | "position" | "department" | "branch" | "role" | "status" | "createdAt"
  | "sss" | "philhealth" | "pagibig" | "tin";
const COLUMNS: { key: ColKey; label: string; width: number; text: (e: EmployeeMaster) => string }[] = [
  { key: "firstName", label: "First Name", width: 140, text: (e) => e.firstName || e.fullName },
  { key: "lastName", label: "Last Name", width: 130, text: (e) => e.lastName },
  { key: "email", label: "Email", width: 220, text: (e) => e.email },
  { key: "position", label: "Position", width: 140, text: (e) => e.position },
  { key: "department", label: "Department", width: 130, text: (e) => e.department },
  { key: "branch", label: "Branch", width: 150, text: (e) => e.branchName ?? "" },
  { key: "role", label: "Role", width: 110, text: (e) => e.accessRole },
  { key: "status", label: "Status", width: 100, text: (e) => e.status },
  { key: "createdAt", label: "Created At", width: 120, text: (e) => fmtDate(e.createdAt) },
  { key: "sss", label: "SSS", width: 140, text: (e) => e.sss },
  { key: "philhealth", label: "PhilHealth", width: 150, text: (e) => e.philhealth },
  { key: "pagibig", label: "Pag-IBIG", width: 150, text: (e) => e.pagibig },
  { key: "tin", label: "TIN", width: 150, text: (e) => e.tin },
];
const DEFAULT_VISIBLE: ColKey[] = ["firstName", "lastName", "email", "position", "branch", "status"];
const ROWS_OPTIONS = [10, 20, 50];

export function EmployeesTab({ managerName, scope }: { managerName: string; scope: Scope }) {
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [org, setOrg] = useState<OrgTree>(EMPTY_ORG);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EmployeeMaster | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(0);
  const [viewOpen, setViewOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [sortKey, setSortKey] = useState<ColKey>("firstName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [loanDraft, setLoanDraft] = useState<Loan>(emptyLoan);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(
    () => Object.fromEntries(COLUMNS.map((c) => [c.key, DEFAULT_VISIBLE.includes(c.key)])) as Record<ColKey, boolean>,
  );

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeOrgTree(setOrg, () => setOrg(EMPTY_ORG)), []);

  const filtered = useMemo(() => {
    // Scope: owner sees all, admin sees their company, manager sees their branch.
    let rows = employees.filter((e) => {
      if (scope.level === "owner") return true;
      if (scope.level === "company") return e.companyId === scope.companyId;
      return e.branchId === scope.branchId;
    });
    if (statusFilter !== "all") rows = rows.filter((e) => e.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) =>
        [e.fullName, e.employeeId, e.department, e.position, e.email].some((v) => v.toLowerCase().includes(q)),
      );
    }
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (col) rows = [...rows].sort((a, b) => col.text(a).localeCompare(col.text(b)) * (sortDir === "asc" ? 1 : -1));
    return rows;
  }, [employees, search, scope, statusFilter, sortKey, sortDir]);

  const cols = COLUMNS.filter((c) => visibleCols[c.key]);
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / rowsPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);

  const toggleSort = (key: ColKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const exportExcel = async () => {
    if (Platform.OS !== "web") return;
    const XLSX = await import("xlsx");
    const header = cols.map((c) => c.label);
    const body = filtered.map((e) => cols.map((c) => c.text(e)));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Employees");
    XLSX.writeFile(wb, "employees.xlsx");
  };

  const startAdd = () => {
    setEditing(blankEmployee());
    setIsNew(true);
    setMessage("");
  };
  const startEdit = (e: EmployeeMaster) => {
    setEditing({ ...e });
    setIsNew(false);
    setMessage("");
  };
  const cancel = () => {
    setEditing(null);
    setMessage("");
  };

  const patch = (p: Partial<EmployeeMaster>) => setEditing((prev) => (prev ? { ...prev, ...p } : prev));

  // Numeric field setter: nullable rates → null when blank; amounts → 0.
  const setNum = (key: keyof EmployeeMaster, nullable: boolean) => (t: string) => {
    const n = parseFloat(t.replace(/[^0-9.]/g, ""));
    patch({ [key]: Number.isFinite(n) ? n : nullable ? null : 0 } as Partial<EmployeeMaster>);
  };
  const loanNum = (key: "principal" | "monthlyAmortization") => (t: string) => {
    const n = parseFloat(t.replace(/[^0-9.]/g, ""));
    setLoanDraft((d) => ({ ...d, [key]: Number.isFinite(n) ? n : 0 }));
  };
  const addLoan = () => {
    if (!editing || loanDraft.monthlyAmortization <= 0 || !/^\d{4}-\d{2}$/.test(loanDraft.startMonth)) return;
    const label = loanDraft.label.trim() || loanTypeLabel(loanDraft.type);
    patch({ loans: [...editing.loans, { ...loanDraft, label }] });
    setLoanDraft(emptyLoan());
  };

  const save = async () => {
    if (!editing) return;
    if (isNew && !editing.employeeId.trim()) {
      setMessage("Employee ID is required.");
      return;
    }
    if (!editing.firstName.trim() && !editing.lastName.trim()) {
      setMessage("Enter the employee's name.");
      return;
    }
    if (editing.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editing.email.trim())) {
      setMessage("Enter a valid email, or leave it blank.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await saveEmployeeMaster(editing, managerName);
      setEditing(null);
    } catch (e) {
      setMessage("Failed to save: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || isNew) return;
    setSaving(true);
    try {
      await deleteEmployee(editing.employeeId, managerName);
      setEditing(null);
    } catch (e) {
      setMessage("Failed to delete: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit / add form (full page) ──
  if (editing) {
    const e = editing;
    return (
      <View>
        <BackLink label="Back to directory" onPress={cancel} />
        <SectionTitle>{isNew ? "New Employee" : `Edit · ${e.fullName || e.employeeId}`}</SectionTitle>

        <Card>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField
                label="Employee ID"
                value={e.employeeId}
                editable={isNew}
                autoCapitalize="characters"
                onChangeText={(t) => patch({ employeeId: t })}
                placeholder="EMP-001"
              />
            </View>
            <View style={styles.col}>
              <Field label="Status">
                <SegmentedControl
                  options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
                  value={e.status}
                  onChange={(v) => patch({ status: v })}
                />
              </Field>
            </View>
          </View>

          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="First name" value={e.firstName} onChangeText={(t) => patch({ firstName: t })} placeholder="Juan" />
            </View>
            <View style={styles.col}>
              <TextField label="Last name" value={e.lastName} onChangeText={(t) => patch({ lastName: t })} placeholder="Dela Cruz" />
            </View>
          </View>

          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Email" value={e.email} autoCapitalize="none" keyboardType="email-address" onChangeText={(t) => patch({ email: t })} placeholder="juan@qui.local" />
            </View>
            <View style={styles.col}>
              <TextField label="Phone" value={e.phone} keyboardType="phone-pad" onChangeText={(t) => patch({ phone: t })} placeholder="0917 000 0000" />
            </View>
          </View>

          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Position" value={e.position} onChangeText={(t) => patch({ position: t })} placeholder="Line Cook" />
            </View>
            <View style={styles.col}>
              <TextField label="Department" value={e.department} onChangeText={(t) => patch({ department: t })} placeholder="Kitchen" />
            </View>
          </View>

          <Field label="Access role">
            <View style={styles.chips}>
              {ACCESS_ROLES.map((r) => (
                <Chip key={r} label={r} active={e.accessRole === r} onPress={() => patch({ accessRole: r })} />
              ))}
            </View>
          </Field>

          <Field label="Employment type" hint={e.workerType === "agency" ? "Agency Personnel are recorded on timekeeping only — excluded from payroll, payslips, bank files, and government reports." : undefined}>
            <View style={styles.chips}>
              {WORKER_TYPES.map((t) => (
                <Chip key={t.value} label={t.label} active={e.workerType === t.value} onPress={() => patch({ workerType: t.value })} />
              ))}
            </View>
          </Field>

          {e.accessRole === "owner" && <Text style={styles.scopeNote}>Owner sees every company, brand, and branch.</Text>}

          {(e.accessRole === "admin" || e.accessRole === "hr") && (
            <Field label="Company (scope — all its brands & branches)">
              {org.companies.length === 0 ? (
                <Text style={styles.scopeNote}>No companies yet — set up the Org tab first.</Text>
              ) : (
                <View style={styles.chips}>
                  {org.companies.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      active={e.companyId === c.id}
                      onPress={() => patch({ companyId: c.id, brandId: null, branchId: null, branchName: null })}
                    />
                  ))}
                </View>
              )}
            </Field>
          )}

          {(e.accessRole === "manager" || e.accessRole === "staff") && (
            <Field label="Branch">
              {org.branches.length === 0 ? (
                <Text style={styles.scopeNote}>No branches yet — set up the Org tab first.</Text>
              ) : (
                <View style={styles.chips}>
                  {org.branches.map((b) => (
                    <Chip
                      key={b.id}
                      label={b.name}
                      active={e.branchId === b.id}
                      onPress={() => patch({ branchId: b.id, branchName: b.name, brandId: b.brandId, companyId: b.companyId })}
                    />
                  ))}
                </View>
              )}
            </Field>
          )}

          {e.accessRole === "areaManager" && (
            <Field label="Branches (area — pick several)">
              {org.branches.length === 0 ? (
                <Text style={styles.scopeNote}>No branches yet — set up the Org tab first.</Text>
              ) : (
                <>
                  <View style={styles.chips}>
                    {org.branches.map((b) => {
                      const on = (e.branchIds ?? []).includes(b.id);
                      return (
                        <Chip
                          key={b.id}
                          label={b.name}
                          active={on}
                          onPress={() => {
                            const cur = e.branchIds ?? [];
                            const next = on ? cur.filter((x) => x !== b.id) : [...cur, b.id];
                            patch({ branchIds: next, companyId: b.companyId });
                          }}
                        />
                      );
                    })}
                  </View>
                  <Text style={styles.scopeNote}>
                    Area manager sees every branch selected above — the same tabs as a branch manager, across the whole area.
                  </Text>
                </>
              )}
            </Field>
          )}

          <TextField label="Hire date" value={e.hireDate ?? ""} onChangeText={(t) => patch({ hireDate: t || null })} placeholder="YYYY-MM-DD" />
        </Card>

        {/* ── Compensation & Deductions (feeds Payroll) ── */}
        <SectionTitle>Compensation &amp; Deductions</SectionTitle>
        <Card>
          <Field label="Pay basis">
            <SegmentedControl
              options={[{ value: "daily", label: "Daily" }, { value: "hourly", label: "Hourly" }]}
              value={e.payType}
              onChange={(v) => patch({ payType: v })}
            />
          </Field>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Daily rate (₱ / day)" value={e.dailyRate != null ? String(e.dailyRate) : ""} keyboardType="numeric" onChangeText={setNum("dailyRate", true)} placeholder="1000" />
            </View>
            <View style={styles.col}>
              <TextField label="Hourly rate (₱ / hr)" value={e.hourlyRate != null ? String(e.hourlyRate) : ""} keyboardType="numeric" onChangeText={setNum("hourlyRate", true)} placeholder="125" />
            </View>
          </View>
          <Text style={styles.scopeNote}>
            {e.payType === "hourly"
              ? "Hourly — basic pay = hourly rate × regular hours worked (from the DTR); overtime is paid on top."
              : "Daily — basic pay = daily rate × days present. The hourly rate (rate ÷ 8) is used for OT & night-differential premiums."}
          </Text>

          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Taxable allowance (₱ / mo)" value={e.allowanceTaxable ? String(e.allowanceTaxable) : ""} keyboardType="numeric" onChangeText={setNum("allowanceTaxable", false)} placeholder="0" />
            </View>
            <View style={styles.col}>
              <TextField label="De-minimis / non-taxable (₱ / mo)" value={e.deMinimis ? String(e.deMinimis) : ""} keyboardType="numeric" onChangeText={setNum("deMinimis", false)} placeholder="0" />
            </View>
          </View>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="SSS loan (₱ / mo)" value={e.sssLoan ? String(e.sssLoan) : ""} keyboardType="numeric" onChangeText={setNum("sssLoan", false)} placeholder="0" />
            </View>
            <View style={styles.col}>
              <TextField label="Pag-IBIG loan (₱ / mo)" value={e.pagibigLoan ? String(e.pagibigLoan) : ""} keyboardType="numeric" onChangeText={setNum("pagibigLoan", false)} placeholder="0" />
            </View>
          </View>
          <TextField label="Cash advance / other deduction (₱ / mo)" value={e.cashAdvance ? String(e.cashAdvance) : ""} keyboardType="numeric" onChangeText={setNum("cashAdvance", false)} placeholder="0" />
        </Card>

        {/* ── Loans ── */}
        <SectionTitle>Loans</SectionTitle>
        <Card>
          {e.loans.length === 0 ? (
            <Text style={styles.scopeNote}>No active loans. Add SSS / Pag-IBIG / company loans or cash advances — each deducts monthly until fully paid.</Text>
          ) : (
            e.loans.map((l, i) => (
              <View key={i} style={styles.loanRow}>
                <View style={styles.grow}>
                  <Text style={styles.loanTitle}>{l.label}</Text>
                  <Text style={styles.loanSub}>{peso(l.monthlyAmortization)}/mo · from {l.startMonth} · principal {peso(l.principal)}</Text>
                  <Text style={styles.loanBal}>Balance now: {peso(loanBalanceAfter(l, thisMonthValue()))}</Text>
                </View>
                <Pressable style={styles.loanDel} onPress={() => patch({ loans: e.loans.filter((_, idx) => idx !== i) })}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={Colors.danger} />
                </Pressable>
              </View>
            ))
          )}

          <View style={styles.loanAdd}>
            <Field label="Add loan">
              <View style={styles.chips}>
                {LOAN_TYPES.map((t) => (
                  <Chip key={t.value} label={t.label} active={loanDraft.type === t.value} onPress={() => setLoanDraft((d) => ({ ...d, type: t.value }))} />
                ))}
              </View>
            </Field>
            <View style={styles.formGrid}>
              <View style={styles.col}>
                <TextField label="Principal (₱)" value={loanDraft.principal ? String(loanDraft.principal) : ""} keyboardType="numeric" onChangeText={loanNum("principal")} placeholder="20000" />
              </View>
              <View style={styles.col}>
                <TextField label="Monthly amortization (₱)" value={loanDraft.monthlyAmortization ? String(loanDraft.monthlyAmortization) : ""} keyboardType="numeric" onChangeText={loanNum("monthlyAmortization")} placeholder="1667" />
              </View>
              <View style={styles.col}>
                <TextField label="Start month (YYYY-MM)" value={loanDraft.startMonth} onChangeText={(t) => setLoanDraft((d) => ({ ...d, startMonth: t }))} placeholder="2026-07" />
              </View>
            </View>
            <Button label="Add loan" icon="plus" size="sm" onPress={addLoan} style={{ alignSelf: "flex-start" }} />
          </View>
        </Card>

        {/* ── Personal details ── */}
        <SectionTitle>Personal Details</SectionTitle>
        <Card>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Birth date" value={e.birthDate ?? ""} onChangeText={(t) => patch({ birthDate: t || null })} placeholder="YYYY-MM-DD" />
            </View>
            <View style={styles.col}>
              <Field label="Gender">
                <View style={styles.chips}>
                  {(["male", "female", "other"] as const).map((g) => (
                    <Chip key={g} label={g} active={e.gender === g} onPress={() => patch({ gender: e.gender === g ? "" : g })} />
                  ))}
                </View>
              </Field>
            </View>
          </View>

          <Field label="Civil status">
            <View style={styles.chips}>
              {(["single", "married", "widowed", "separated"] as const).map((c) => (
                <Chip key={c} label={c} active={e.civilStatus === c} onPress={() => patch({ civilStatus: e.civilStatus === c ? "" : c })} />
              ))}
            </View>
          </Field>

          <TextField label="Address" value={e.address} multiline onChangeText={(t) => patch({ address: t })} placeholder="House no., street, barangay, city, province" />

          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Emergency contact — name" value={e.emergencyContactName} onChangeText={(t) => patch({ emergencyContactName: t })} placeholder="Maria Dela Cruz" />
            </View>
            <View style={styles.col}>
              <TextField label="Emergency contact — phone" value={e.emergencyContactPhone} keyboardType="phone-pad" onChangeText={(t) => patch({ emergencyContactPhone: t })} placeholder="0917 000 0000" />
            </View>
          </View>
        </Card>

        {/* ── Government IDs ── */}
        <SectionTitle>Government IDs</SectionTitle>
        <Card>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="SSS no." value={e.sss} onChangeText={(t) => patch({ sss: t })} placeholder="00-0000000-0" />
            </View>
            <View style={styles.col}>
              <TextField label="PhilHealth no." value={e.philhealth} onChangeText={(t) => patch({ philhealth: t })} placeholder="00-000000000-0" />
            </View>
          </View>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Pag-IBIG no." value={e.pagibig} onChangeText={(t) => patch({ pagibig: t })} placeholder="0000-0000-0000" />
            </View>
            <View style={styles.col}>
              <TextField label="TIN" value={e.tin} onChangeText={(t) => patch({ tin: t })} placeholder="000-000-000-000" />
            </View>
          </View>
          <View style={styles.formGrid}>
            <View style={styles.col}>
              <TextField label="Bank / e-wallet (for payroll)" value={e.bankName} onChangeText={(t) => patch({ bankName: t })} placeholder="BDO / GCash" />
            </View>
            <View style={styles.col}>
              <TextField label="Account number" value={e.bankAccount} onChangeText={(t) => patch({ bankAccount: t })} placeholder="0000-0000-0000" />
            </View>
          </View>
        </Card>

        <View style={styles.formActions}>
          {!isNew && <Button label="Delete" variant="danger" icon="trash-can-outline" onPress={remove} disabled={saving} />}
          <View style={{ flex: 1 }} />
          <Button label="Cancel" variant="ghost" onPress={cancel} disabled={saving} />
          <Button label={saving ? "Saving…" : "Save"} onPress={save} loading={saving} />
        </View>
        {message ? <View style={{ marginTop: 12 }}><InlineMessage text={message} tone="error" /></View> : null}
        {!isNew && (
          <Text style={styles.note}>
            This manages the HR record only. Login credentials (Firebase Auth) are provisioned separately.
          </Text>
        )}
      </View>
    );
  }

  // ── Directory (full-width table) ──
  const renderCell = (e: EmployeeMaster, key: ColKey) => {
    if (key === "status")
      return <Badge label={e.status === "active" ? "Active" : "Inactive"} tone={e.status === "active" ? "in" : "out"} />;
    const col = COLUMNS.find((c) => c.key === key)!;
    return (
      <Text style={styles.cellText} numberOfLines={1}>
        {col.text(e) || "—"}
      </Text>
    );
  };

  const onDeleteRow = async (e: EmployeeMaster) => {
    if (Platform.OS === "web" && typeof window !== "undefined" && !window.confirm(`Delete ${e.fullName}?`)) return;
    try {
      await deleteEmployee(e.employeeId, managerName);
    } catch (err) {
      setMessage("Delete failed: " + (err instanceof Error ? err.message : "unknown error"));
    }
  };

  const backdrop = (onPress: () => void) => <Pressable onPress={onPress} style={fixedBackdrop} />;

  return (
    <View>
      {/* Toolbar: search + column view + export + add */}
      <View style={styles.toolbar}>
        <SearchInput
          value={search}
          onChangeText={(t) => {
            setSearch(t);
            setPage(0);
          }}
          placeholder="Search employees…"
        />
        <View style={styles.toolbarBtns}>
          <View style={[styles.dropWrap, viewOpen && styles.dropWrapOpen]}>
            <Button label="View" variant="ghost" size="sm" icon="tune-variant" onPress={() => setViewOpen((v) => !v)} />
            {viewOpen && (
              <>
                {backdrop(() => setViewOpen(false))}
                <View style={[styles.menu, { right: 0 }]}>
                  <Text style={styles.menuHeader}>Toggle columns</Text>
                  {COLUMNS.map((c) => (
                    <Pressable key={c.key} style={styles.menuItem} onPress={() => setVisibleCols((v) => ({ ...v, [c.key]: !v[c.key] }))}>
                      <MaterialCommunityIcons
                        name={visibleCols[c.key] ? "checkbox-marked" : "checkbox-blank-outline"}
                        size={17}
                        color={visibleCols[c.key] ? Colors.primary : Colors.textFaint}
                      />
                      <Text style={styles.menuItemText}>{c.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
          {Platform.OS === "web" && (
            <Button label="Export Excel" variant="ghost" size="sm" icon="microsoft-excel" onPress={exportExcel} />
          )}
          <Button label="Add" size="sm" icon="plus" onPress={startAdd} />
        </View>
      </View>

      {/* Filter row */}
      <View style={styles.filterRow}>
        <Select
          value={statusFilter}
          width={150}
          options={[
            { value: "all", label: "Status: All" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          onChange={(v) => {
            setStatusFilter(v as "all" | "active" | "inactive");
            setPage(0);
          }}
        />
      </View>

      {message ? <InlineMessage text={message} tone="error" /> : null}

      {/* Table */}
      {total === 0 ? (
        <EmptyState icon="account-group-outline" text={employees.length ? "No matches" : "No employees yet — add your first"} />
      ) : (
        <View style={styles.tableCard}>
          <View style={styles.theadRow}>
            {cols.map((c) => (
              <Pressable key={c.key} style={[styles.th, { width: c.width }]} onPress={() => toggleSort(c.key)}>
                <Text style={styles.thText} numberOfLines={1}>{c.label}</Text>
                <MaterialCommunityIcons
                  name={sortKey === c.key ? (sortDir === "asc" ? "menu-up" : "menu-down") : "unfold-more-horizontal"}
                  size={14}
                  color={sortKey === c.key ? Colors.primary : Colors.textPlaceholder}
                />
              </Pressable>
            ))}
            <View style={[styles.th, { width: 52 }]} />
          </View>
          {pageRows.map((e, i) => (
            <View
              key={e.employeeId}
              style={[styles.tr, i < pageRows.length - 1 && styles.trBorder, rowMenuId === e.employeeId && styles.trMenuOpen]}
            >
              {cols.map((c) => (
                <Pressable key={c.key} style={[styles.tdCell, { width: c.width }]} onPress={() => startEdit(e)}>
                  {renderCell(e, c.key)}
                </Pressable>
              ))}
              <View style={[styles.tdCell, styles.actionsCell]}>
                <Pressable style={styles.dotsBtn} onPress={() => setRowMenuId((id) => (id === e.employeeId ? null : e.employeeId))}>
                  <MaterialCommunityIcons name="dots-horizontal" size={18} color={Colors.textMuted} />
                </Pressable>
                {rowMenuId === e.employeeId && (
                  <>
                    {backdrop(() => setRowMenuId(null))}
                    <View style={[styles.menu, styles.rowMenu]}>
                      <Pressable
                        style={styles.menuItem}
                        onPress={() => {
                          setRowMenuId(null);
                          startEdit(e);
                        }}
                      >
                        <MaterialCommunityIcons name="pencil-outline" size={16} color={Colors.textBody} />
                        <Text style={styles.menuItemText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        style={styles.menuItem}
                        onPress={() => {
                          setRowMenuId(null);
                          onDeleteRow(e);
                        }}
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color={Colors.danger} />
                        <Text style={[styles.menuItemText, { color: Colors.danger }]}>Delete</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Pagination footer */}
      {total > 0 && (
        <View style={styles.pager}>
          <Text style={styles.pagerText}>Total rows: {total}</Text>
          <View style={styles.pagerRight}>
            <Text style={styles.pagerText}>Rows per page</Text>
            <Pressable
              style={styles.rppBtn}
              onPress={() => {
                const next = ROWS_OPTIONS[(ROWS_OPTIONS.indexOf(rowsPerPage) + 1) % ROWS_OPTIONS.length];
                setRowsPerPage(next);
                setPage(0);
              }}
            >
              <Text style={styles.pagerText}>{rowsPerPage}</Text>
              <MaterialCommunityIcons name="chevron-down" size={16} color={Colors.textMuted} />
            </Pressable>
            <Text style={styles.pagerText}>
              Page {safePage + 1} of {pageCount}
            </Text>
            <Pressable style={styles.pagerBtn} disabled={safePage <= 0} onPress={() => setPage((p) => Math.max(0, p - 1))}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={safePage <= 0 ? Colors.textPlaceholder : Colors.textBody} />
            </Pressable>
            <Pressable
              style={styles.pagerBtn}
              disabled={safePage >= pageCount - 1}
              onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              <MaterialCommunityIcons name="chevron-right" size={20} color={safePage >= pageCount - 1 ? Colors.textPlaceholder : Colors.textBody} />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const fixedBackdrop = { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 } as unknown as object;

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },

  // Form layout
  formGrid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  col: { flexGrow: 1, flexBasis: 200, minWidth: 200 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scopeNote: { color: Colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  formActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  note: { marginTop: 10, color: Colors.textFaint, fontSize: 12, lineHeight: 17 },

  // Loans
  loanRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  loanTitle: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  loanSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  loanBal: { fontSize: 12, fontWeight: "700", color: Colors.primary, marginTop: 3 },
  loanDel: { width: 38, height: 38, borderRadius: 9, backgroundColor: Colors.dangerTint, alignItems: "center", justifyContent: "center" },
  loanAdd: { marginTop: 14 },

  // Toolbar
  toolbar: { flexDirection: "row", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" },
  toolbarBtns: { flexDirection: "row", alignItems: "center", gap: 8 },

  // Dropdowns (column view + row menu)
  dropWrap: { position: "relative" },
  dropWrapOpen: { zIndex: 50 },
  menu: {
    position: "absolute",
    top: 42,
    minWidth: 190,
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderRadius: 12,
    paddingVertical: 6,
    zIndex: 50,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  menuHeader: { fontSize: 11, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 12, paddingVertical: 6 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  menuItemText: { fontSize: 13, color: Colors.textPrimary, fontWeight: "600" },

  // Filter row
  filterRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14, zIndex: 30 },

  // Table
  tableCard: { backgroundColor: Colors.cardSurface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline, overflow: "hidden" },
  theadRow: { flexDirection: "row", backgroundColor: Colors.warmSurface },
  th: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 13 },
  thText: { fontSize: 11.5, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5 },
  tr: { flexDirection: "row", alignItems: "center" },
  trBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  trMenuOpen: { position: "relative", zIndex: 30 },
  tdCell: { paddingHorizontal: 14, paddingVertical: 13, justifyContent: "center" },
  cellText: { fontSize: 14, color: Colors.textPrimary },
  actionsCell: { width: 52, position: "relative", alignItems: "center" },
  dotsBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowMenu: { right: 8, top: 40 },

  // Pagination
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 16 },
  pagerText: { fontSize: 13, color: Colors.textMuted, fontWeight: "600" },
  pagerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  rppBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.cardSurface },
  pagerBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.cardSurface, alignItems: "center", justifyContent: "center" },
});
