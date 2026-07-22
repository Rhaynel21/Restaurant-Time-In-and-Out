import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge, Button, Card, Chip, EmptyState, InlineMessage, SectionTitle, Select, TextField } from "@/components/manager/ui";
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
  formTop: { marginTop: 16 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },

  memoHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  memoSubject: { flex: 1, fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  memoBody: { fontSize: 14, color: Colors.textMuted, marginTop: 8, lineHeight: 20 },
  memoMeta: { fontSize: 12, color: Colors.textFaint, marginTop: 10 },
});
