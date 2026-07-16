import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import {
  EmployeeDocument,
  deleteEmployeeDocument,
  formatSize,
  subscribeEmployeeDocuments,
  uploadEmployeeDocument,
} from "@/lib/documents";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import { inScope } from "@/lib/org";

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function iconFor(contentType: string, name: string): MdIcon {
  const t = (contentType || name).toLowerCase();
  if (t.includes("pdf")) return "file-pdf-box";
  if (/(png|jpg|jpeg|gif|webp|image)/.test(t)) return "file-image";
  if (/(word|doc)/.test(t)) return "file-word-box";
  if (/(sheet|excel|xls|csv)/.test(t)) return "file-excel-box";
  return "file-outline";
}

export function DocumentsTab({ managerName, allowed }: { managerName: string; allowed: Set<string> | null }) {
  const [allEmployees, setAllEmployees] = useState<EmployeeSummary[]>([]);
  const employees = allEmployees.filter((e) => inScope(e.branchId, allowed));
  const [selected, setSelected] = useState<EmployeeSummary | null>(null);
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => subscribeEmployees(setAllEmployees, () => setAllEmployees([])), []);

  useEffect(() => {
    if (!selected) {
      setDocs([]);
      return;
    }
    return subscribeEmployeeDocuments(selected.employeeId, setDocs, () => setDocs([]));
  }, [selected]);

  const upload = () => {
    if (!selected || Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv,image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      setMessage("");
      try {
        await uploadEmployeeDocument(selected.employeeId, file, managerName, Date.now());
        setMessage(`✓ Uploaded ${file.name}`);
      } catch (e) {
        setMessage("Upload failed: " + (e instanceof Error ? e.message : "unknown error"));
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const remove = async (d: EmployeeDocument) => {
    setMessage("");
    try {
      await deleteEmployeeDocument(d.id, d.storagePath);
    } catch (e) {
      setMessage("Delete failed: " + (e instanceof Error ? e.message : "unknown error"));
    }
  };

  return (
    <View>
      <SectionTitle>Employee</SectionTitle>
      <Card>
        <View style={styles.chips}>
          {employees.length === 0 ? (
            <Text style={styles.muted}>Loading employees…</Text>
          ) : (
            employees.map((e) => {
              const active = e.employeeId === selected?.employeeId;
              return (
                <Pressable key={e.employeeId} style={[styles.chip, active && styles.chipOn]} onPress={() => setSelected(e)}>
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>{e.fullName}</Text>
                </Pressable>
              );
            })
          )}
        </View>
      </Card>

      {selected && (
        <>
          <View style={styles.head}>
            <SectionTitle>{selected.fullName}&apos;s 201 File</SectionTitle>
            {Platform.OS === "web" && (
              <Pressable style={[styles.uploadBtn, uploading && { opacity: 0.7 }]} disabled={uploading} onPress={upload}>
                <MaterialCommunityIcons name="tray-arrow-up" size={18} color="#fff" />
                <Text style={styles.uploadText}>{uploading ? "Uploading…" : "Upload document"}</Text>
              </Pressable>
            )}
          </View>

          {message ? <Text style={styles.message}>{message}</Text> : null}

          {docs.length === 0 ? (
            <EmptyState icon="folder-open-outline" text="No documents yet — upload contracts, IDs, or forms" />
          ) : (
            docs.map((d) => (
              <Card key={d.id}>
                <View style={styles.row}>
                  <View style={styles.fileIcon}>
                    <MaterialCommunityIcons name={iconFor(d.contentType, d.name)} size={24} color={Colors.primary} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {formatSize(d.size)}
                      {d.uploadedAt ? ` · ${d.uploadedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                      {d.uploadedBy ? ` · by ${d.uploadedBy}` : ""}
                    </Text>
                  </View>
                  <Pressable style={styles.openBtn} onPress={() => d.url && Linking.openURL(d.url)}>
                    <MaterialCommunityIcons name="open-in-new" size={18} color={Colors.primaryDark} />
                  </Pressable>
                  <Pressable style={styles.delBtn} onPress={() => remove(d)}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={Colors.danger} />
                  </Pressable>
                </View>
              </Card>
            ))
          )}
        </>
      )}

      {!selected && employees.length > 0 && (
        <EmptyState icon="folder-account-outline" text="Pick an employee to view their documents" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textPrimary },
  chipTextOn: { color: "#fff" },
  muted: { color: Colors.textFaint, fontSize: 13 },

  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
  uploadBtn: { flexDirection: "row", alignItems: "center", gap: 8, height: 42, paddingHorizontal: 16, borderRadius: 11, backgroundColor: Colors.primary, marginBottom: 14 },
  uploadText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  message: { marginBottom: 12, color: Colors.textMuted, fontWeight: "600", fontSize: 13 },

  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  fileIcon: { width: 44, height: 44, borderRadius: 11, backgroundColor: Colors.warmSurface, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textFaint, marginTop: 2 },
  openBtn: { width: 38, height: 38, borderRadius: 9, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  delBtn: { width: 38, height: 38, borderRadius: 9, backgroundColor: Colors.dangerTint, alignItems: "center", justifyContent: "center" },
});
