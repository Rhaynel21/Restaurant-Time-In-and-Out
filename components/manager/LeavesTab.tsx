import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { Colors } from "@/constants/theme";
import { LEAVE_TYPES, LeaveRequest, formatRange, subscribeAllLeaves } from "@/lib/leaves";

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

export function LeavesTab() {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  useEffect(() => subscribeAllLeaves(setItems, () => setItems([])), []);

  return (
    <View>
      <SectionTitle>All Leave Requests</SectionTitle>
      {items.length === 0 ? (
        <EmptyState icon="calendar-blank-outline" text="No leave requests yet" />
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
                {l.reviewedBy ? (
                  <Text style={styles.sub}>
                    {l.status === "approved" ? "Approved" : l.status === "rejected" ? "Rejected" : "Reviewed"} by {l.reviewedBy}
                  </Text>
                ) : null}
              </View>
              <Badge
                label={l.status[0].toUpperCase() + l.status.slice(1)}
                tone={l.status as "pending" | "approved" | "rejected"}
              />
            </View>
            {l.reason ? <Text style={styles.reason}>{l.reason}</Text> : null}
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  icon: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: "700", fontSize: 15, color: Colors.textPrimary },
  sub: { color: Colors.textFaint, fontSize: 13 },
  reason: { marginTop: 12, color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
});
