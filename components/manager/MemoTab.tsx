import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import { Memo, MemoStatus, createMemo, subscribeMemos } from "@/lib/memos";
import { inScope } from "@/lib/org";

export function MemoTab({ managerName, allowed }: { managerName: string; allowed: Set<string> | null }) {
  const [allEmployees, setAllEmployees] = useState<EmployeeSummary[]>([]);
  const employees = useMemo(() => allEmployees.filter((e) => inScope(e.branchId, allowed)), [allEmployees, allowed]);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [memos, setMemos] = useState<Memo[]>([]);

  useEffect(() => subscribeEmployees(setAllEmployees, () => setAllEmployees([])), []);
  useEffect(() => subscribeMemos(setMemos, () => setMemos([])), []);

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
        <View style={styles.chips}>
          {employees.length === 0 ? (
            <Text style={styles.muted}>No employees in scope.</Text>
          ) : (
            employees.map((e) => {
              const on = recipients.has(e.employeeId);
              return (
                <Pressable key={e.employeeId} style={[styles.chip, on && styles.chipOn]} onPress={() => toggle(e.employeeId)}>
                  {on && <MaterialCommunityIcons name="check" size={14} color="#fff" />}
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{e.fullName}</Text>
                </Pressable>
              );
            })
          )}
        </View>

        <Text style={[styles.label, { marginTop: 16 }]}>Subject</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Memo subject (optional)"
          placeholderTextColor={Colors.textPlaceholder}
        />

        <Text style={[styles.label, { marginTop: 14 }]}>Memo Content</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={content}
          onChangeText={setContent}
          placeholder="Write your memo here…"
          placeholderTextColor={Colors.textPlaceholder}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.actions}>
          <Pressable style={[styles.ghostBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => submit("draft")}>
            <Text style={styles.ghostText}>Save Memo</Text>
          </Pressable>
          <Pressable style={[styles.sendBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => submit("sent")}>
            <MaterialCommunityIcons name="send" size={16} color="#fff" />
            <Text style={styles.sendText}>Send Memo</Text>
          </Pressable>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Card>

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
  recipHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectAll: { fontSize: 13, fontWeight: "700", color: Colors.primary },
  muted: { color: Colors.textFaint, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  chipTextOn: { color: "#fff" },
  input: { borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, color: Colors.textPrimary, minHeight: 46 },
  textarea: { minHeight: 120 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  ghostBtn: { height: 46, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 14 },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 8, height: 46, paddingHorizontal: 22, borderRadius: 12, backgroundColor: Colors.primary },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  message: { marginTop: 12, color: Colors.textMuted, fontWeight: "600", fontSize: 13 },

  memoHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  memoSubject: { flex: 1, fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  memoBody: { fontSize: 14, color: Colors.textMuted, marginTop: 8, lineHeight: 20 },
  memoMeta: { fontSize: 12, color: Colors.textFaint, marginTop: 10 },
});
