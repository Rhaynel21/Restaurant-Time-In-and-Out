import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge, Button, Card, Chip, EmptyState, InlineMessage, SectionTitle, Select, TextField } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRecord, getAttendanceSince } from "@/lib/attendance";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import { MEMO_TEMPLATES } from "@/lib/memo-templates";
import { Memo, MemoStatus, createMemo, subscribeMemos } from "@/lib/memos";
import { inScope } from "@/lib/org";
import { Schedule, effectiveShift, emptySchedule, getAllSchedules, shiftBlocks } from "@/lib/schedules";

const DAY_MS = 86_400_000;
const GRACE_MIN = 15; // minutes past the scheduled start before a punch counts as late

// Is this punch late? Compared to the employee's SCHEDULED shift start for that
// day (not a fixed clock time) so evening/night shifts aren't wrongly flagged.
function isLateForShift(sched: Schedule, checkIn: Date): boolean {
  const ymd = `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, "0")}-${String(checkIn.getDate()).padStart(2, "0")}`;
  const shift = effectiveShift(sched, ymd);
  if (shift.off) return false;
  const blocks = shiftBlocks(shift);
  if (blocks.length === 0) return false;
  const [sh, sm] = blocks[0].start.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(sm)) return false;
  const startMin = sh * 60 + sm;
  const inMin = checkIn.getHours() * 60 + checkIn.getMinutes();
  return inMin > startMin + GRACE_MIN;
}

type MemoSuggestion = { employeeId: string; name: string; reason: string; templateKey: string; tone: "warn" | "good" };

export function MemoTab({ managerName, allowed }: { managerName: string; allowed: Set<string> | null }) {
  const [allEmployees, setAllEmployees] = useState<EmployeeSummary[]>([]);
  const employees = useMemo(() => allEmployees.filter((e) => inScope(e.branchId, allowed)), [allEmployees, allowed]);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [att30, setAtt30] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<Map<string, Schedule>>(new Map());

  useEffect(() => subscribeEmployees(setAllEmployees, () => setAllEmployees([])), []);
  useEffect(() => subscribeMemos(setMemos, () => setMemos([])), []);
  useEffect(() => {
    getAttendanceSince(Date.now() - 30 * DAY_MS).then(setAtt30).catch(() => setAtt30([]));
    getAllSchedules().then(setSchedules).catch(() => setSchedules(new Map()));
  }, []);

  // Suggest a memo per employee from the last 30 days of attendance: repeat
  // tardiness → Attendance Warning; no attendance at all (still active) → AWOL
  // notice; consistently on-time & present → optional Commendation.
  const suggestions = useMemo<MemoSuggestion[]>(() => {
    const byEmp = new Map<string, { lates: number; days: Set<string> }>();
    for (const r of att30) {
      const cur = byEmp.get(r.employeeId) ?? { lates: 0, days: new Set<string>() };
      const sched = schedules.get(r.employeeId) ?? emptySchedule(r.employeeId);
      if (isLateForShift(sched, r.checkInAt)) cur.lates += 1;
      cur.days.add(`${r.checkInAt.getFullYear()}-${r.checkInAt.getMonth()}-${r.checkInAt.getDate()}`);
      byEmp.set(r.employeeId, cur);
    }
    const out: MemoSuggestion[] = [];
    for (const e of employees) {
      // Only employees with actual attendance in the window get a signal, so new
      // or inactive staff (no punches) aren't wrongly flagged.
      const s = byEmp.get(e.employeeId);
      if (!s) continue;
      const lates = s.lates;
      const days = s.days.size;
      if (lates >= 3) {
        out.push({ employeeId: e.employeeId, name: e.fullName, reason: `${lates} late arrivals in the last 30 days`, templateKey: "attendance", tone: "warn" });
      } else if (days >= 20 && lates === 0) {
        out.push({ employeeId: e.employeeId, name: e.fullName, reason: `${days} days present, no tardiness`, templateKey: "commendation", tone: "good" });
      }
    }
    // Concerns first, then commendations; cap the list so it stays scannable.
    return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "warn" ? -1 : 1)).slice(0, 8);
  }, [att30, employees, schedules]);

  const composeFrom = (s: MemoSuggestion) => {
    const t = MEMO_TEMPLATES.find((x) => x.key === s.templateKey);
    setRecipients(new Set([s.employeeId]));
    if (t) {
      setSubject(t.subject);
      setContent(t.content);
    }
    setMessage(`Loaded ${t?.label ?? "template"} for ${s.name} — fill in the blanks before sending.`);
  };

  const toggle = (id: string) =>
    setRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = employees.length > 0 && recipients.size === employees.length;
  const selectAll = () =>
    setRecipients(allSelected ? new Set() : new Set(employees.map((e) => e.employeeId)));

  const submit = async (status: MemoStatus) => {
    if (recipients.size === 0) {
      setMessage("Pick at least one recipient.");
      return;
    }
    if (!content.trim()) {
      setMessage("Write the memo content.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const picked = employees.filter((e) => recipients.has(e.employeeId));
      await createMemo(
        {
          subject,
          content,
          recipientIds: picked.map((e) => e.employeeId),
          recipientNames: picked.map((e) => e.fullName),
          status,
        },
        managerName,
      );
      setMessage(status === "sent" ? "✓ Memo sent." : "✓ Memo saved as draft.");
      setSubject("");
      setContent("");
      setRecipients(new Set());
    } catch (e) {
      setMessage("Failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {suggestions.length > 0 && (
        <>
          <SectionTitle>Suggested Memos</SectionTitle>
          <Card>
            <Text style={styles.suggestHint}>Flagged from the last 30 days of attendance — tap to load a pre-filled draft.</Text>
            {suggestions.map((s) => (
              <View key={s.employeeId} style={styles.suggestRow}>
                <View style={[styles.suggestDot, s.tone === "warn" ? styles.dotWarn : styles.dotGood]} />
                <View style={styles.suggestMain}>
                  <Text style={styles.suggestName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.suggestReason} numberOfLines={1}>{s.reason}</Text>
                </View>
                <Button
                  label={s.tone === "warn" ? "Draft warning" : "Commend"}
                  variant={s.tone === "warn" ? "ghost" : "ghost"}
                  size="sm"
                  icon={s.tone === "warn" ? "alert-outline" : "star-outline"}
                  onPress={() => composeFrom(s)}
                />
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Compose Memo</SectionTitle>
      <Card>
        <View style={styles.recipHead}>
          <Text style={styles.label}>Recipients ({recipients.size})</Text>
          {employees.length > 0 && (
            <Pressable onPress={selectAll}>
              <Text style={styles.selectAll}>{allSelected ? "Clear all" : "Select all"}</Text>
            </Pressable>
          )}
        </View>
        {employees.length === 0 ? (
          <Text style={styles.muted}>No employees in scope.</Text>
        ) : (
          <Select
            value={null}
            searchable
            placeholder="Search employees to add…"
            width={320}
            options={employees
              .filter((e) => !recipients.has(e.employeeId))
              .map((e) => ({ value: e.employeeId, label: e.fullName }))}
            onChange={(id) => toggle(id)}
          />
        )}
        {recipients.size > 0 && (
          <View style={styles.recipChips}>
            {employees
              .filter((e) => recipients.has(e.employeeId))
              .map((e) => (
                <Chip key={e.employeeId} label={e.fullName} active icon="close" onPress={() => toggle(e.employeeId)} />
              ))}
          </View>
        )}

        <View style={styles.templateRow}>
          <Text style={styles.label}>Start from a template</Text>
          <Select
            value={null}
            width={320}
            placeholder="Pick a common memo…"
            options={MEMO_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))}
            onChange={(key) => {
              const t = MEMO_TEMPLATES.find((x) => x.key === key);
              if (t) {
                setSubject(t.subject);
                setContent(t.content);
                setMessage("Template loaded — fill in the blanks (____ and [brackets]) before sending.");
              }
            }}
          />
        </View>

        <View style={styles.formTop}>
          <TextField label="Subject" value={subject} onChangeText={setSubject} placeholder="Memo subject (optional)" />
          <TextField label="Memo content" value={content} onChangeText={setContent} placeholder="Write your memo here…" multiline />
        </View>

        <View style={styles.actions}>
          <Button label="Save memo" variant="ghost" disabled={busy} onPress={() => submit("draft")} />
          <Button label="Send memo" icon="send" loading={busy} onPress={() => submit("sent")} />
        </View>
        {message ? <InlineMessage text={message} tone={message.startsWith("✓") ? "success" : "error"} /> : null}
      </Card>

      {(subject.trim() || content.trim()) ? (
        <>
          <SectionTitle>Preview</SectionTitle>
          <Card style={styles.previewCard}>
            <Text style={styles.previewTitle}>MEMORANDUM</Text>
            <View style={styles.previewMeta}>
              {[
                { k: "TO", v: employees.filter((e) => recipients.has(e.employeeId)).map((e) => e.fullName).join(", ") || "—" },
                { k: "FROM", v: managerName },
                { k: "DATE", v: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) },
                ...(subject.trim() ? [{ k: "SUBJECT", v: subject }] : []),
              ].map((r) => (
                <View key={r.k} style={styles.previewRow}>
                  <Text style={styles.previewK}>{r.k}</Text>
                  <Text style={styles.previewColon}>:</Text>
                  <Text style={styles.previewV}>{r.v}</Text>
                </View>
              ))}
            </View>
            <View style={styles.previewDivider} />
            <Text style={styles.previewBody}>{content || "(memo body will appear here)"}</Text>
          </Card>
        </>
      ) : null}

      <SectionTitle>Recent Memos</SectionTitle>
      {memos.length === 0 ? (
        <EmptyState icon="email-outline" text="No memos yet" />
      ) : (
        memos.map((m) => (
          <Card key={m.id}>
            <View style={styles.memoHead}>
              <Text style={styles.memoSubject} numberOfLines={1}>
                {m.subject || "(No subject)"}
              </Text>
              <Badge label={m.status === "sent" ? "Sent" : "Draft"} tone={m.status === "sent" ? "approved" : "pending"} />
            </View>
            <Text style={styles.memoBody} numberOfLines={2}>
              {m.content}
            </Text>
            <Text style={styles.memoMeta} numberOfLines={1}>
              To {m.recipientNames.length} · {m.recipientNames.slice(0, 3).join(", ")}
              {m.recipientNames.length > 3 ? "…" : ""} · by {m.createdBy}
            </Text>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 8 },
  recipHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  selectAll: { fontSize: 13, fontWeight: "700", color: Colors.primary },
  muted: { color: Colors.textFaint, fontSize: 13 },
  recipChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  templateRow: { marginTop: 16, gap: 6, zIndex: 5 },
  formTop: { marginTop: 16 },

  suggestHint: { fontSize: 12, color: Colors.textFaint, marginBottom: 8 },
  suggestRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: Colors.hairline },
  suggestDot: { width: 8, height: 8, borderRadius: 4 },
  dotWarn: { backgroundColor: Colors.warningDeep },
  dotGood: { backgroundColor: Colors.success },
  suggestMain: { flex: 1, minWidth: 0 },
  suggestName: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  suggestReason: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },

  // Live memo preview — a document-style rendering of the composed memo.
  previewCard: { backgroundColor: "#fff" },
  previewTitle: { fontSize: 16, fontWeight: "800", letterSpacing: 2, textAlign: "center", color: Colors.textPrimary, marginBottom: 14 },
  previewMeta: { gap: 3 },
  previewRow: { flexDirection: "row", alignItems: "flex-start" },
  previewK: { width: 68, fontSize: 12, fontWeight: "800", color: Colors.textSubtle, letterSpacing: 0.4 },
  previewColon: { width: 10, fontSize: 12, fontWeight: "800", color: Colors.textSubtle },
  previewV: { flex: 1, fontSize: 13, fontWeight: "600", color: Colors.textPrimary },
  previewDivider: { height: 1, backgroundColor: Colors.hairline, marginVertical: 14 },
  previewBody: { fontSize: 13, lineHeight: 20, color: Colors.textPrimary, fontFamily: "monospace" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },

  memoHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  memoSubject: { flex: 1, fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  memoBody: { fontSize: 14, color: Colors.textMuted, marginTop: 8, lineHeight: 20 },
  memoMeta: { fontSize: 12, color: Colors.textFaint, marginTop: 10 },
});
