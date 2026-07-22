import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Button, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import {
  LEAVE_TYPES,
  LeaveRequest,
  formatRange,
  reviewLeave,
  subscribePendingLeaves,
} from "@/lib/leaves";
import { notify } from "@/lib/notifications";

const ICON: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  vacation: "umbrella-beach",
  sick: "medical-bag",
  emergency: "alarm-light-outline",
  unpaid: "cash-remove",
};

function tint(type: string) {
  return LEAVE_TYPES.find((t) => t.key === type)?.tint ?? Colors.primary;
}
function typeLabel(type: string) {
  return LEAVE_TYPES.find((t) => t.key === type)?.label ?? "Leave";
}

export function ApprovalsTab({ reviewerName }: { reviewerName: string }) {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribePendingLeaves(setItems, () => setItems([])), []);

  const decide = async (l: LeaveRequest, decision: "approved" | "rejected") => {
    try {
      setBusy(l.id);
      await reviewLeave(l.id, decision, reviewerName);
      notify(
        l.employeeId,
        `Leave ${decision}`,
        `Your ${typeLabel(l.type).toLowerCase()} leave (${formatRange(l.startDate, l.endDate)}) was ${decision}.`,
        decision === "approved" ? "success" : "warning",
      );
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <SectionTitle>Pending Leave Requests</SectionTitle>
      {items.length === 0 ? (
        <EmptyState icon="check-circle-outline" text="No pending requests" />
      ) : (
        items.map((l) => (
          <Card key={l.id}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: tint(l.type) + "1A" }]}>
                <MaterialCommunityIcons name={ICON[l.type] ?? "note-text-outline"} size={22} color={tint(l.type)} />
              </View>
              <View style={styles.grow}>
                <Text style={styles.title}>{l.employeeName}</Text>
                <Text style={styles.sub}>
                  {typeLabel(l.type)} · {formatRange(l.startDate, l.endDate)} · {l.days} day{l.days > 1 ? "s" : ""}
                </Text>
              </View>
              <Badge label="Pending" tone="pending" />
            </View>
            {l.reason ? <Text style={styles.reason}>{l.reason}</Text> : null}
            <View style={styles.actions}>
              <Button label="Reject" variant="ghost" disabled={busy === l.id} onPress={() => decide(l, "rejected")} />
              <Button label="Approve" icon="check" loading={busy === l.id} onPress={() => decide(l, "approved")} />
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  icon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  title: { fontWeight: "700", fontSize: 15, color: Colors.textPrimary },
  sub: { color: Colors.textFaint, fontSize: 13, marginTop: 2 },
  reason: { marginTop: 12, color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 },
});
