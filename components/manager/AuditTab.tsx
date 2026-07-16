import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { AuditEntry, subscribeAuditLog } from "@/lib/audit";

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function iconFor(entity: string): MdIcon {
  if (entity === "employee") return "account-edit-outline";
  if (entity === "payroll") return "cash-sync";
  if (entity === "leave") return "airplane";
  if (entity === "request") return "clock-edit-outline";
  return "pencil-outline";
}
function tone(action: string): string {
  if (action === "approved" || action === "save") return Colors.success;
  if (action === "rejected" || action === "delete") return Colors.danger;
  return Colors.textMuted;
}

export function AuditTab() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  useEffect(() => subscribeAuditLog(setItems, () => setItems([])), []);

  return (
    <View>
      <SectionTitle>Audit Log</SectionTitle>
      {items.length === 0 ? (
        <EmptyState icon="history" text="No audit entries yet — sensitive changes will appear here" />
      ) : (
        items.map((e) => (
          <Card key={e.id}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: tone(e.action) + "1A" }]}>
                <MaterialCommunityIcons name={iconFor(e.entity)} size={20} color={tone(e.action)} />
              </View>
              <View style={styles.grow}>
                <Text style={styles.title}>{e.summary || `${e.entity} ${e.action}`}</Text>
                <Text style={styles.sub}>
                  {e.entity} · {e.entityId}
                  {e.at ? ` · ${e.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                </Text>
              </View>
              <Text style={styles.actor}>{e.actor}</Text>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  title: { fontWeight: "700", fontSize: 14, color: Colors.textPrimary },
  sub: { color: Colors.textFaint, fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  actor: { fontSize: 12, fontWeight: "700", color: Colors.textMuted, maxWidth: 120, textAlign: "right" },
});
