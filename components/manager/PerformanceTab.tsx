import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle, Select } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { EmployeeMaster, subscribeEmployeeMasters } from "@/lib/hr";
import {
  Appraisal,
  DEFAULT_KPIS,
  DISCIPLINE_TYPES,
  DisciplinaryAction,
  KpiScore,
  createAppraisal,
  createDisciplinaryAction,
  finalizeAppraisal,
  ratingLabel,
  resolveDisciplinaryAction,
  subscribeAppraisals,
  subscribeDisciplinaryActions,
} from "@/lib/performance";

function ratingTone(overall: number): "approved" | "in" | "pending" | "rejected" {
  if (overall >= 3.5) return "approved";
  if (overall >= 2.5) return "in";
  if (overall >= 1.5) return "pending";
  return "rejected";
}

export function PerformanceTab({ managerName }: { managerName: string }) {
  const [mode, setMode] = useState<"appraisals" | "discipline">("appraisals");
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [discipline, setDiscipline] = useState<DisciplinaryAction[]>([]);

  useEffect(() => subscribeEmployeeMasters(setEmployees, () => setEmployees([])), []);
  useEffect(() => subscribeAppraisals(setAppraisals, () => setAppraisals([])), []);
  useEffect(() => subscribeDisciplinaryActions(setDiscipline, () => setDiscipline([])), []);

  const empOptions = employees.map((e) => ({ value: e.employeeId, label: e.fullName }));

  return (
    <View>
      <View style={styles.segment}>
        {(["appraisals", "discipline"] as const).map((m) => (
          <Pressable key={m} style={[styles.segBtn, mode === m && styles.segOn]} onPress={() => setMode(m)}>
            <Text style={[styles.segText, mode === m && styles.segTextOn]}>{m === "appraisals" ? "Appraisals & KPIs" : "Disciplinary Records"}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "appraisals" ? (
        <AppraisalsView employees={empOptions} rows={appraisals} managerName={managerName} />
      ) : (
        <DisciplineView employees={empOptions} rows={discipline} managerName={managerName} />
      )}
    </View>
  );
}

// ── Appraisals ───────────────────────────────────────────────────────────────
function AppraisalsView({ employees, rows, managerName }: { employees: { value: string; label: string }[]; rows: Appraisal[]; managerName: string }) {
  const [show, setShow] = useState(false);
  const [empId, setEmpId] = useState<string | null>(null);
  const [period, setPeriod] = useState("");
  const [kpis, setKpis] = useState<KpiScore[]>(DEFAULT_KPIS.map((name) => ({ name, score: 3 })));
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [busy, setBusy] = useState(false);

  const overall = useMemo(() => (kpis.length ? kpis.reduce((t, k) => t + k.score, 0) / kpis.length : 0), [kpis]);

  const reset = () => {
    setEmpId(null); setPeriod(""); setKpis(DEFAULT_KPIS.map((name) => ({ name, score: 3 }))); setStrengths(""); setImprovements(""); setShow(false);
  };

  const save = async (status: "draft" | "final") => {
    const emp = employees.find((e) => e.value === empId);
    if (!emp || !period.trim()) return;
    setBusy(true);
    try {
      await createAppraisal({ employeeId: emp.value, employeeName: emp.label, period: period.trim(), reviewer: managerName, kpis, strengths: strengths.trim(), improvements: improvements.trim(), status }, managerName);
      reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.headerRow}>
        <SectionTitle>Performance Appraisals</SectionTitle>
        <Pressable style={styles.addBtn} onPress={() => setShow((v) => !v)}>
          <MaterialCommunityIcons name={show ? "close" : "plus"} size={18} color="#fff" />
          <Text style={styles.addText}>{show ? "Cancel" : "New Appraisal"}</Text>
        </Pressable>
      </View>

      {show && (
        <Card>
          <View style={styles.grid}>
            <View style={styles.field}>
              <Text style={styles.label}>Employee</Text>
              <Select value={empId} options={employees} onChange={setEmpId} placeholder="Select employee" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Review period</Text>
              <TextInput style={styles.input} value={period} onChangeText={setPeriod} placeholder="e.g. 2026 H1" placeholderTextColor={Colors.textPlaceholder} />
            </View>
          </View>

          <Text style={[styles.formHead, { marginTop: 14 }]}>KPI Ratings (1–5)</Text>
          {kpis.map((k, i) => (
            <View key={k.name} style={styles.kpiRow}>
              <Text style={styles.kpiName}>{k.name}</Text>
              <View style={styles.scoreRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} style={[styles.scoreDot, k.score === n && styles.scoreDotOn]} onPress={() => setKpis(kpis.map((x, j) => (j === i ? { ...x, score: n } : x)))}>
                    <Text style={[styles.scoreText, k.score === n && styles.scoreTextOn]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <View style={styles.overallRow}>
            <Text style={styles.overallLabel}>Overall</Text>
            <Text style={styles.overallVal}>{overall.toFixed(2)} / 5 · {ratingLabel(overall)}</Text>
          </View>

          <TextInput style={[styles.input, styles.multiline]} value={strengths} onChangeText={setStrengths} multiline placeholder="Strengths / commendations" placeholderTextColor={Colors.textPlaceholder} />
          <TextInput style={[styles.input, styles.multiline]} value={improvements} onChangeText={setImprovements} multiline placeholder="Areas for improvement" placeholderTextColor={Colors.textPlaceholder} />

          <View style={styles.btnRow}>
            <Pressable style={[styles.ghostBtn, busy && styles.dim]} disabled={busy} onPress={() => save("draft")}>
              <Text style={styles.ghostText}>Save draft</Text>
            </Pressable>
            <Pressable style={[styles.primaryBtn, busy && styles.dim]} disabled={busy} onPress={() => save("final")}>
              <Text style={styles.primaryText}>Finalize & notify</Text>
            </Pressable>
          </View>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="star-outline" text="No appraisals recorded yet" />
      ) : (
        rows.map((a) => (
          <Card key={a.id}>
            <View style={styles.applRow}>
              <View style={styles.grow}>
                <Text style={styles.applName}>{a.employeeName}</Text>
                <Text style={styles.applSub}>{a.period} · Reviewer: {a.reviewer || "—"}</Text>
                <View style={styles.kpiChips}>
                  {a.kpis.map((k) => (
                    <View key={k.name} style={styles.chip}>
                      <Text style={styles.chipText}>{k.name}: {k.score}</Text>
                    </View>
                  ))}
                </View>
                {a.strengths ? <Text style={styles.applNotes}>💪 {a.strengths}</Text> : null}
                {a.improvements ? <Text style={styles.applNotes}>🎯 {a.improvements}</Text> : null}
              </View>
              <View style={styles.stageCol}>
                <Text style={styles.bigScore}>{a.overall.toFixed(2)}</Text>
                <Badge label={ratingLabel(a.overall)} tone={ratingTone(a.overall)} />
                <Badge label={a.status === "final" ? "Final" : "Draft"} tone={a.status === "final" ? "approved" : "pending"} />
                {a.status === "draft" ? (
                  <Pressable style={styles.linkBtn} onPress={() => finalizeAppraisal(a, managerName)}>
                    <Text style={styles.linkText}>Finalize</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

// ── Disciplinary ─────────────────────────────────────────────────────────────
function DisciplineView({ employees, rows, managerName }: { employees: { value: string; label: string }[]; rows: DisciplinaryAction[]; managerName: string }) {
  const [show, setShow] = useState(false);
  const [empId, setEmpId] = useState<string | null>(null);
  const [type, setType] = useState<string>(DISCIPLINE_TYPES[0]);
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setEmpId(null); setType(DISCIPLINE_TYPES[0]); setDate(""); setDescription(""); setAction(""); setShow(false); };

  const save = async () => {
    const emp = employees.find((e) => e.value === empId);
    if (!emp || !description.trim()) return;
    setBusy(true);
    try {
      await createDisciplinaryAction({ employeeId: emp.value, employeeName: emp.label, type, incidentDate: date.trim(), description: description.trim(), action: action.trim(), issuedBy: managerName }, managerName);
      reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.headerRow}>
        <SectionTitle>Disciplinary Records</SectionTitle>
        <Pressable style={styles.addBtn} onPress={() => setShow((v) => !v)}>
          <MaterialCommunityIcons name={show ? "close" : "plus"} size={18} color="#fff" />
          <Text style={styles.addText}>{show ? "Cancel" : "New Record"}</Text>
        </Pressable>
      </View>

      {show && (
        <Card>
          <View style={styles.grid}>
            <View style={styles.field}>
              <Text style={styles.label}>Employee</Text>
              <Select value={empId} options={employees} onChange={setEmpId} placeholder="Select employee" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Action type</Text>
              <Select value={type} options={DISCIPLINE_TYPES.map((t) => ({ value: t, label: t }))} onChange={setType} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Incident date</Text>
              <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textPlaceholder} />
            </View>
          </View>
          <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} multiline placeholder="Description of incident / violation" placeholderTextColor={Colors.textPlaceholder} />
          <TextInput style={[styles.input, styles.multiline]} value={action} onChangeText={setAction} multiline placeholder="Corrective action taken" placeholderTextColor={Colors.textPlaceholder} />
          <Pressable style={[styles.primaryBtn, busy && styles.dim]} disabled={busy} onPress={save}>
            <Text style={styles.primaryText}>Record & notify employee</Text>
          </Pressable>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="gavel" text="No disciplinary records" />
      ) : (
        rows.map((d) => (
          <Card key={d.id}>
            <View style={styles.applRow}>
              <View style={styles.grow}>
                <Text style={styles.applName}>{d.employeeName}</Text>
                <Text style={styles.applSub}>{d.type}{d.incidentDate ? ` · ${d.incidentDate}` : ""} · by {d.issuedBy || "—"}</Text>
                {d.description ? <Text style={styles.applNotes}>{d.description}</Text> : null}
                {d.action ? <Text style={styles.applNotes}>Action: {d.action}</Text> : null}
              </View>
              <View style={styles.stageCol}>
                <Badge label={d.status === "open" ? "Open" : "Resolved"} tone={d.status === "open" ? "rejected" : "approved"} />
                {d.status === "open" ? (
                  <Pressable style={styles.linkBtn} onPress={() => resolveDisciplinaryAction(d, managerName)}>
                    <Text style={styles.linkText}>Mark resolved</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", gap: 6, backgroundColor: Colors.warmSurfaceAlt, borderRadius: 12, padding: 4, marginBottom: 16, alignSelf: "flex-start" },
  segBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9 },
  segOn: { backgroundColor: Colors.cardSurface, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  segText: { fontSize: 14, fontWeight: "700", color: Colors.textFaint },
  segTextOn: { color: Colors.textPrimary },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 11, backgroundColor: Colors.primary },
  addText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  grid: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  field: { flexGrow: 1, flexBasis: 200, gap: 6 },
  label: { fontSize: 12, fontWeight: "700", color: Colors.textSubtle },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: Colors.textPrimary, outlineStyle: "none" } as object,
  multiline: { minHeight: 64, marginTop: 10, textAlignVertical: "top" } as object,
  formHead: { fontSize: 13, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, backgroundColor: Colors.primary, marginTop: 12, paddingHorizontal: 20 },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  ghostBtn: { alignItems: "center", justifyContent: "center", height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, marginTop: 12, paddingHorizontal: 20 },
  ghostText: { color: Colors.textMuted, fontWeight: "700", fontSize: 14 },
  btnRow: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  dim: { opacity: 0.6 },

  kpiRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  kpiName: { fontSize: 14, color: Colors.textBody, fontWeight: "600", flex: 1 },
  scoreRow: { flexDirection: "row", gap: 6 },
  scoreDot: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center", backgroundColor: Colors.warmSurface },
  scoreDotOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  scoreText: { fontSize: 14, fontWeight: "700", color: Colors.textMuted },
  scoreTextOn: { color: "#fff" },
  overallRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.hairline },
  overallLabel: { fontSize: 14, fontWeight: "800", color: Colors.textPrimary },
  overallVal: { fontSize: 14, fontWeight: "700", color: Colors.primary },

  applRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  applName: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  applSub: { fontSize: 13, color: Colors.textFaint, marginTop: 2 },
  applNotes: { fontSize: 13, color: Colors.textMuted, marginTop: 6, lineHeight: 18 },
  kpiChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: Colors.warmSurfaceAlt },
  chipText: { fontSize: 12, fontWeight: "600", color: Colors.textMuted },
  stageCol: { alignItems: "flex-end", gap: 8 },
  bigScore: { fontSize: 26, fontWeight: "800", color: Colors.textPrimary },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.warmBorder },
  linkText: { fontSize: 12, fontWeight: "700", color: Colors.textMuted },
});
