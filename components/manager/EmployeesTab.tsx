import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AccessRole } from "@/lib/auth";
import { EmployeeMaster, blankEmployee, deleteEmployee, saveEmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import { OrgTree, Scope, subscribeOrgTree } from "@/lib/org";

const ACCESS_ROLES: AccessRole[] = ["owner", "admin", "manager", "staff"];

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
  const [org, setOrg] = useState<OrgTree>({ companies: [], brands: [], branches: [] });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EmployeeMaster | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(0);
  const [viewOpen, setViewOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [sortKey, setSortKey] = useState<ColKey>("firstName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(
    () => Object.fromEntries(COLUMNS.map((c) => [c.key, DEFAULT_VISIBLE.includes(c.key)])) as Record<ColKey, boolean>,
  );

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeOrgTree(setOrg, () => setOrg({ companies: [], brands: [], branches: [] })), []);

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
      await deleteEmployee(editing.employeeId);
      setEditing(null);
    } catch (e) {
      setMessage("Failed to delete: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  // ── Edit / add form ──
  if (editing) {
    const e = editing;
    return (
      <View>
        <Pressable style={styles.back} onPress={cancel}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={Colors.textMuted} />
          <Text style={styles.backText}>Back to directory</Text>
        </Pressable>
        <SectionTitle>{isNew ? "New Employee" : `Edit · ${e.fullName || e.employeeId}`}</SectionTitle>

        <Card>
          <View style={styles.formGrid}>
            <Field label="Employee ID" grow>
              <TextInput
                style={[styles.input, !isNew && styles.inputLocked]}
                value={e.employeeId}
                editable={isNew}
                autoCapitalize="characters"
                onChangeText={(t) => patch({ employeeId: t })}
                placeholder="EMP-001"
                placeholderTextColor={Colors.textPlaceholder}
              />
            </Field>
            <Field label="Status" grow>
              <View style={styles.segRow}>
                {(["active", "inactive"] as const).map((s) => (
                  <Pressable key={s} style={[styles.seg, e.status === s && styles.segOn]} onPress={() => patch({ status: s })}>
                    <Text style={[styles.segText, e.status === s && styles.segTextOn]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
          </View>

          <View style={styles.formGrid}>
            <Field label="First name" grow>
              <TextInput style={styles.input} value={e.firstName} onChangeText={(t) => patch({ firstName: t })} placeholder="Juan" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Last name" grow>
              <TextInput style={styles.input} value={e.lastName} onChangeText={(t) => patch({ lastName: t })} placeholder="Dela Cruz" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>

          <View style={styles.formGrid}>
            <Field label="Email" grow>
              <TextInput style={styles.input} value={e.email} autoCapitalize="none" keyboardType="email-address" onChangeText={(t) => patch({ email: t })} placeholder="juan@qui.local" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Phone" grow>
              <TextInput style={styles.input} value={e.phone} keyboardType="phone-pad" onChangeText={(t) => patch({ phone: t })} placeholder="0917 000 0000" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>

          <View style={styles.formGrid}>
            <Field label="Position" grow>
              <TextInput style={styles.input} value={e.position} onChangeText={(t) => patch({ position: t })} placeholder="Line Cook" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Department" grow>
              <TextInput style={styles.input} value={e.department} onChangeText={(t) => patch({ department: t })} placeholder="Kitchen" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>

          <Field label="Access role">
            <View style={styles.segRow}>
              {ACCESS_ROLES.map((r) => (
                <Pressable key={r} style={[styles.seg, e.accessRole === r && styles.segOn]} onPress={() => patch({ accessRole: r })}>
                  <Text style={[styles.segText, e.accessRole === r && styles.segTextOn]}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </Field>

          {e.accessRole === "owner" && (
            <Text style={styles.scopeNote}>Owner sees every company, brand, and branch.</Text>
          )}

          {e.accessRole === "admin" && (
            <Field label="Company (scope — all its brands & branches)">
              {org.companies.length === 0 ? (
                <Text style={styles.scopeNote}>No companies yet — set up the Org tab first.</Text>
              ) : (
                <View style={styles.chips}>
                  {org.companies.map((c) => (
                    <Pressable
                      key={c.id}
                      style={[styles.chip, e.companyId === c.id && styles.chipOn]}
                      onPress={() => patch({ companyId: c.id, brandId: null, branchId: null, branchName: null })}
                    >
                      <Text style={[styles.chipText, e.companyId === c.id && styles.chipTextOn]}>{c.name}</Text>
                    </Pressable>
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
                    <Pressable
                      key={b.id}
                      style={[styles.chip, e.branchId === b.id && styles.chipOn]}
                      onPress={() => patch({ branchId: b.id, branchName: b.name, brandId: b.brandId, companyId: b.companyId })}
                    >
                      <Text style={[styles.chipText, e.branchId === b.id && styles.chipTextOn]}>{b.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Field>
          )}

          <Field label="Hire date">
            <TextInput style={styles.input} value={e.hireDate ?? ""} onChangeText={(t) => patch({ hireDate: t || null })} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textPlaceholder} />
          </Field>
        </Card>

        {/* ── Compensation & Deductions (feeds Payroll) ── */}
        <SectionTitle>Compensation &amp; Deductions</SectionTitle>
        <Card>
          <Field label="Pay basis">
            <View style={styles.segRow}>
              {(["daily", "hourly"] as const).map((p) => (
                <Pressable key={p} style={[styles.seg, e.payType === p && styles.segOn]} onPress={() => patch({ payType: p })}>
                  <Text style={[styles.segText, e.payType === p && styles.segTextOn]}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </Field>
          <View style={styles.formGrid}>
            <Field label="Daily rate (₱ / day)" grow>
              <TextInput style={styles.input} value={e.dailyRate != null ? String(e.dailyRate) : ""} keyboardType="numeric" onChangeText={setNum("dailyRate", true)} placeholder="1000" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Hourly rate (₱ / hr)" grow>
              <TextInput style={styles.input} value={e.hourlyRate != null ? String(e.hourlyRate) : ""} keyboardType="numeric" onChangeText={setNum("hourlyRate", true)} placeholder="125" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>
          <Text style={styles.scopeNote}>
            {e.payType === "hourly"
              ? "Hourly — basic pay = hourly rate × regular hours worked (from the DTR); overtime is paid on top."
              : "Daily — basic pay = daily rate × days present. The hourly rate (rate ÷ 8) is used for OT & night-differential premiums."}
          </Text>

          <View style={styles.formGrid}>
            <Field label="Taxable allowance (₱ / mo)" grow>
              <TextInput style={styles.input} value={e.allowanceTaxable ? String(e.allowanceTaxable) : ""} keyboardType="numeric" onChangeText={setNum("allowanceTaxable", false)} placeholder="0" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="De-minimis / non-taxable (₱ / mo)" grow>
              <TextInput style={styles.input} value={e.deMinimis ? String(e.deMinimis) : ""} keyboardType="numeric" onChangeText={setNum("deMinimis", false)} placeholder="0" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>
          <View style={styles.formGrid}>
            <Field label="SSS loan (₱ / mo)" grow>
              <TextInput style={styles.input} value={e.sssLoan ? String(e.sssLoan) : ""} keyboardType="numeric" onChangeText={setNum("sssLoan", false)} placeholder="0" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Pag-IBIG loan (₱ / mo)" grow>
              <TextInput style={styles.input} value={e.pagibigLoan ? String(e.pagibigLoan) : ""} keyboardType="numeric" onChangeText={setNum("pagibigLoan", false)} placeholder="0" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>
          <Field label="Cash advance / other deduction (₱ / mo)">
            <TextInput style={styles.input} value={e.cashAdvance ? String(e.cashAdvance) : ""} keyboardType="numeric" onChangeText={setNum("cashAdvance", false)} placeholder="0" placeholderTextColor={Colors.textPlaceholder} />
          </Field>
        </Card>

        {/* ── Personal details ── */}
        <SectionTitle>Personal Details</SectionTitle>
        <Card>
          <View style={styles.formGrid}>
            <Field label="Birth date" grow>
              <TextInput style={styles.input} value={e.birthDate ?? ""} onChangeText={(t) => patch({ birthDate: t || null })} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Gender" grow>
              <View style={styles.segRow}>
                {(["male", "female", "other"] as const).map((g) => (
                  <Pressable key={g} style={[styles.seg, e.gender === g && styles.segOn]} onPress={() => patch({ gender: e.gender === g ? "" : g })}>
                    <Text style={[styles.segText, e.gender === g && styles.segTextOn]}>{g}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
          </View>

          <Field label="Civil status">
            <View style={styles.segRow}>
              {(["single", "married", "widowed", "separated"] as const).map((c) => (
                <Pressable key={c} style={[styles.seg, e.civilStatus === c && styles.segOn]} onPress={() => patch({ civilStatus: e.civilStatus === c ? "" : c })}>
                  <Text style={[styles.segText, e.civilStatus === c && styles.segTextOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </Field>

          <Field label="Address">
            <TextInput style={[styles.input, styles.inputMultiline]} value={e.address} multiline onChangeText={(t) => patch({ address: t })} placeholder="House no., street, barangay, city, province" placeholderTextColor={Colors.textPlaceholder} />
          </Field>

          <View style={styles.formGrid}>
            <Field label="Emergency contact — name" grow>
              <TextInput style={styles.input} value={e.emergencyContactName} onChangeText={(t) => patch({ emergencyContactName: t })} placeholder="Maria Dela Cruz" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="Emergency contact — phone" grow>
              <TextInput style={styles.input} value={e.emergencyContactPhone} keyboardType="phone-pad" onChangeText={(t) => patch({ emergencyContactPhone: t })} placeholder="0917 000 0000" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>
        </Card>

        {/* ── Government IDs ── */}
        <SectionTitle>Government IDs</SectionTitle>
        <Card>
          <View style={styles.formGrid}>
            <Field label="SSS no." grow>
              <TextInput style={styles.input} value={e.sss} onChangeText={(t) => patch({ sss: t })} placeholder="00-0000000-0" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="PhilHealth no." grow>
              <TextInput style={styles.input} value={e.philhealth} onChangeText={(t) => patch({ philhealth: t })} placeholder="00-000000000-0" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>
          <View style={styles.formGrid}>
            <Field label="Pag-IBIG no." grow>
              <TextInput style={styles.input} value={e.pagibig} onChangeText={(t) => patch({ pagibig: t })} placeholder="0000-0000-0000" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
            <Field label="TIN" grow>
              <TextInput style={styles.input} value={e.tin} onChangeText={(t) => patch({ tin: t })} placeholder="000-000-000-000" placeholderTextColor={Colors.textPlaceholder} />
            </Field>
          </View>
        </Card>

        <View style={styles.formActions}>
          {!isNew && (
            <Pressable style={styles.deleteBtn} disabled={saving} onPress={remove}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color={Colors.danger} />
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          <Pressable style={styles.ghostBtn} disabled={saving} onPress={cancel}>
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} disabled={saving} onPress={save}>
            <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {!isNew && (
          <Text style={styles.note}>
            This manages the HR record only. Login credentials (Firebase Auth) are provisioned separately.
          </Text>
        )}
      </View>
    );
  }

  // ── Directory (table) ──
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
      await deleteEmployee(e.employeeId);
    } catch (err) {
      setMessage("Delete failed: " + (err instanceof Error ? err.message : "unknown error"));
    }
  };

  const backdrop = (onPress: () => void) => (
    <Pressable onPress={onPress} style={fixedBackdrop} />
  );

  const statusLabel = statusFilter === "all" ? "Status: All" : statusFilter === "active" ? "Active" : "Inactive";

  return (
    <View>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={Colors.textFaint} />
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={(t) => {
              setSearch(t);
              setPage(0);
            }}
            placeholder="Search…"
            placeholderTextColor={Colors.textPlaceholder}
          />
        </View>
        <View style={styles.toolbarBtns}>
          <View style={[styles.dropWrap, viewOpen && styles.dropWrapOpen]}>
            <Pressable style={styles.toolBtn} onPress={() => setViewOpen((v) => !v)}>
              <MaterialCommunityIcons name="tune-variant" size={16} color={Colors.textBody} />
              <Text style={styles.toolBtnText}>View</Text>
            </Pressable>
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
            <Pressable style={styles.toolBtn} onPress={exportExcel}>
              <MaterialCommunityIcons name="microsoft-excel" size={16} color={Colors.success} />
              <Text style={styles.toolBtnText}>Export Excel</Text>
            </Pressable>
          )}
          <Pressable style={styles.addBtnSm} onPress={startAdd}>
            <MaterialCommunityIcons name="plus" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Filter row */}
      <View style={styles.filterRow}>
        <View style={[styles.dropWrap, statusOpen && styles.dropWrapOpen]}>
          <Pressable style={styles.filterBtn} onPress={() => setStatusOpen((o) => !o)}>
            <Text style={styles.filterText}>{statusLabel}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color={Colors.textMuted} />
          </Pressable>
          {statusOpen && (
            <>
              {backdrop(() => setStatusOpen(false))}
              <View style={[styles.menu, { left: 0 }]}>
                {(["all", "active", "inactive"] as const).map((s) => (
                  <Pressable
                    key={s}
                    style={styles.menuItem}
                    onPress={() => {
                      setStatusFilter(s);
                      setStatusOpen(false);
                      setPage(0);
                    }}
                  >
                    <Text style={styles.menuItemText}>{s === "all" ? "All" : s === "active" ? "Active" : "Inactive"}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
        {message ? <Text style={styles.errorMsg}>{message}</Text> : null}
      </View>

      {/* Table */}
      {total === 0 ? (
        <EmptyState icon="account-group-outline" text={employees.length ? "No matches" : "No employees yet — add your first"} />
      ) : (
        <View style={styles.tableCard}>
          <View>
            <View>
              <View style={styles.theadRow}>
                {cols.map((c) => (
                  <Pressable key={c.key} style={[styles.th, { width: c.width }]} onPress={() => toggleSort(c.key)}>
                    <Text style={styles.thText} numberOfLines={1}>
                      {c.label}
                    </Text>
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
                  style={[
                    styles.tr,
                    i < pageRows.length - 1 && styles.trBorder,
                    rowMenuId === e.employeeId && styles.trMenuOpen,
                  ]}
                >
                  {cols.map((c) => (
                    <Pressable key={c.key} style={[styles.tdCell, { width: c.width }]} onPress={() => startEdit(e)}>
                      {renderCell(e, c.key)}
                    </Pressable>
                  ))}
                  <View style={[styles.tdCell, styles.actionsCell]}>
                    <Pressable
                      style={styles.dotsBtn}
                      onPress={() => setRowMenuId((id) => (id === e.employeeId ? null : e.employeeId))}
                    >
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
          </View>
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

function Field({ label, grow, children }: { label: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <View style={[styles.field, grow && styles.fieldGrow]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", gap: 12, marginBottom: 18, flexWrap: "wrap" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexGrow: 1,
    flexBasis: 240,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  search: { flex: 1, fontSize: 14, color: Colors.textPrimary, outlineStyle: "none" } as object,
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.primary },
  addText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  avatarOff: { backgroundColor: Colors.textFaint },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  idTag: { fontSize: 12, fontWeight: "600", color: Colors.textFaint },
  sub: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },

  // Form
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  backText: { color: Colors.textMuted, fontWeight: "600", fontSize: 13 },
  formGrid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  field: { marginBottom: 14 },
  fieldGrow: { flexGrow: 1, flexBasis: 200 },
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 6 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary, outlineStyle: "none" } as object,
  inputMultiline: { height: 72, paddingTop: 12, textAlignVertical: "top" } as object,
  inputLocked: { opacity: 0.6 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  chipTextOn: { color: "#fff" },

  segRow: { flexDirection: "row", gap: 6 },
  seg: { paddingHorizontal: 16, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  segOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segText: { fontSize: 13, fontWeight: "700", color: Colors.textMuted, textTransform: "capitalize" },
  segTextOn: { color: "#fff" },

  formActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 46, paddingHorizontal: 16, borderRadius: 12, backgroundColor: Colors.dangerTint, borderWidth: 1, borderColor: "rgba(178,58,58,0.2)" },
  deleteText: { color: Colors.danger, fontWeight: "700", fontSize: 14 },
  ghostBtn: { height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 14 },
  saveBtn: { height: 46, paddingHorizontal: 26, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  message: { marginTop: 12, color: Colors.textMuted, fontWeight: "600", fontSize: 13 },
  note: { marginTop: 10, color: Colors.textFaint, fontSize: 12, lineHeight: 17 },
  scopeNote: { color: Colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 14 },

  // Toolbar
  toolbarBtns: { flexDirection: "row", alignItems: "center", gap: 8 },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  toolBtnText: { fontSize: 13, fontWeight: "700", color: Colors.textBody },
  addBtnSm: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },

  // Dropdowns
  dropWrap: { position: "relative" },
  dropWrapOpen: { zIndex: 50 },
  menu: {
    position: "absolute",
    top: 46,
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
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  filterText: { fontSize: 13, fontWeight: "600", color: Colors.textBody },
  errorMsg: { color: Colors.danger, fontSize: 13, fontWeight: "600" },

  // Table
  tableCard: { backgroundColor: Colors.cardSurface, borderRadius: 16, borderWidth: 1, borderColor: Colors.hairline },
  theadRow: { flexDirection: "row", backgroundColor: Colors.warmSurface, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  th: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 13 },
  thText: { fontSize: 12, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4 },
  tr: { flexDirection: "row", alignItems: "center" },
  trBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  // Lift the row whose action menu is open above the rows below it, so the
  // absolutely-positioned Edit/Delete menu isn't painted over by later rows.
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
