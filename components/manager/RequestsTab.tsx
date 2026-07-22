import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, Button, Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AttendanceRequest, reviewAttendanceRequest, subscribeAllRequests } from "@/lib/attendance-requests";
import { notify } from "@/lib/notifications";
import { inScope } from "@/lib/org";

function detail(r: AttendanceRequest): string {
  if (r.kind === "overtime") return `${r.hours ?? 0} h overtime on ${r.date}`;
  const parts = [r.correctIn ? `in ${r.correctIn}` : "", r.correctOut ? `out ${r.correctOut}` : ""].filter(Boolean).join(", ");
  return `DTR correction · ${r.date}${parts ? ` · ${parts}` : ""}`;
}

export function RequestsTab({ reviewerName, allowed }: { reviewerName: string; allowed: Set<string> | null }) {
  const [items, setItems] = useState<AttendanceRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => subscribeAllRequests(setItems, () => setItems([])), []);

  const scoped = useMemo(() => items.filter((r) => inScope(r.branchId, allowed)), [items, allowed]);
  const pending = scoped.filter((r) => r.status === "pending");
  const history = scoped.filter((r) => r.status !== "pending");

  const act = async (r: AttendanceRequest, decision: "approved" | "rejected") => {
    setBusy(r.id);
    try {
      await reviewAttendanceRequest(r.id, decision, reviewerName);
      const what = r.kind === "overtime" ? `Overtime (${r.hours ?? 0} h) on ${r.date}` : `DTR correction on ${r.date}`;
      notify(r.employeeId, `Request ${decision}`, `${what} was ${decision}.`, decision === "approved" ? "success" : "warning");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <SectionTitle>Pending Requests</SectionTitle>
      {pending.length === 0 ? (
        <EmptyState icon="check-decagram-outline" text="No pending overtime or correction requests" />
      ) : (
        pending.map((r) => (
          <Card key={r.id}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: (r.kind === "overtime" ? Colors.warning : Colors.info) + "1A" }]}>
                <MaterialCommunityIcons name={r.kind === "overtime" ? "clock-plus-outline" : "clock-edit-outline"} size={22} color={r.kind === "overtime" ? Colors.warning : Colors.info} />
              </View>
              <View style={styles.grow}>
                <Text style={styles.title}>{r.employeeName}</Text>
                <Text style={styles.sub}>{detail(r)}</Text>
                {r.branchName ? <Text style={styles.sub}>{r.branchName}</Text> : null}
              </View>
              <Badge label="Pending" tone="pending" />
            </View>
            {r.reason ? <Text style={styles.reason}>{r.reason}</Text> : null}
            <View style={styles.actions}>
              <Button label="Reject" variant="ghost" disabled={busy === r.id} onPress={() => act(r, "rejected")} />
              <Button label="Approve" icon="check" loading={busy === r.id} onPress={() => act(r, "approved")} />
            </View>
          </Card>
        ))
      )}

      <SectionTitle>History</SectionTitle>
      {history.length === 0 ? (
        <EmptyState icon="history" text="No reviewed requests yet" />
      ) : (
        history.map((r) => (
          <Card key={r.id}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.title}>{r.employeeName}</Text>
                <Text style={styles.sub}>{detail(r)}</Text>
                {r.reviewedBy ? <Text style={styles.sub}>{r.status === "approved" ? "Approved" : "Rejected"} by {r.reviewedBy}</Text> : null}
              </View>
              <Badge label={r.status[0].toUpperCase() + r.status.slice(1)} tone={r.status as "approved" | "rejected"} />
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
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: "700", fontSize: 15, color: Colors.textPrimary },
  sub: { color: Colors.textFaint, fontSize: 13 },
  reason: { marginTop: 12, color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 },
});
