import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card, SectionTitle } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import {
  Branch,
  Brand,
  OrgTree,
  deleteBranch,
  deleteBrand,
  deleteCompany,
  migrateQuiOrg,
  saveBranch,
  saveBrand,
  saveCompany,
  subscribeOrgTree,
} from "@/lib/org";

type Editor =
  | { kind: "company"; id: string; name: string; code: string; isNew: boolean }
  | { kind: "brand"; id: string; name: string; code: string; companyId: string; isNew: boolean }
  | { kind: "branch"; id: string; name: string; code: string; companyId: string; brandId: string; address: string; isNew: boolean };

function slug(s: string) {
  return s.trim().toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

export function OrgTab() {
  const [tree, setTree] = useState<OrgTree>({ companies: [], brands: [], branches: [] });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => subscribeOrgTree(setTree, () => setMessage("Can't load org (check Firestore rules).")), []);

  const brandsByCompany = useMemo(() => {
    const m = new Map<string, Brand[]>();
    tree.brands.forEach((b) => m.set(b.companyId, [...(m.get(b.companyId) ?? []), b]));
    return m;
  }, [tree.brands]);
  const branchesByBrand = useMemo(() => {
    const m = new Map<string, Branch[]>();
    tree.branches.forEach((b) => m.set(b.brandId, [...(m.get(b.brandId) ?? []), b]));
    return m;
  }, [tree.branches]);

  const migrate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await migrateQuiOrg();
      setMessage(res.skipped ? "Org already has companies — skipped." : `✓ Migrated Qui (${res.created} branches).`);
    } catch (e) {
      setMessage("Migrate failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editor) return;
    if (!editor.name.trim()) {
      setMessage("Name is required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const id = editor.isNew ? slug(editor.code || editor.name) || `${editor.kind}-${Date.now()}` : editor.id;
      if (editor.kind === "company") await saveCompany({ id, name: editor.name.trim(), code: editor.code.trim() });
      else if (editor.kind === "brand")
        await saveBrand({ id, name: editor.name.trim(), code: editor.code.trim(), companyId: editor.companyId });
      else
        await saveBranch({
          id,
          name: editor.name.trim(),
          code: editor.code.trim(),
          companyId: editor.companyId,
          brandId: editor.brandId,
          address: editor.address.trim(),
        });
      setEditor(null);
    } catch (e) {
      setMessage("Save failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage("Delete failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setBusy(false);
    }
  };

  // ── Editor form ──
  if (editor) {
    return (
      <View>
        <Pressable style={styles.back} onPress={() => setEditor(null)}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={Colors.textMuted} />
          <Text style={styles.backText}>Back to organization</Text>
        </Pressable>
        <SectionTitle>
          {editor.isNew ? "New" : "Edit"} {editor.kind}
        </SectionTitle>
        <Card>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={editor.name}
            onChangeText={(t) => setEditor({ ...editor, name: t })}
            placeholder={editor.kind === "company" ? "Jollibee Foods Corp" : editor.kind === "brand" ? "Jollibee" : "Jollibee — Makati"}
            placeholderTextColor={Colors.textPlaceholder}
          />
          <Text style={styles.label}>Code</Text>
          <TextInput
            style={styles.input}
            value={editor.code}
            onChangeText={(t) => setEditor({ ...editor, code: t })}
            placeholder="Short code (e.g. JFC)"
            placeholderTextColor={Colors.textPlaceholder}
          />
          {editor.kind === "branch" && (
            <>
              <Text style={styles.label}>Address</Text>
              <TextInput
                style={styles.input}
                value={editor.address}
                onChangeText={(t) => setEditor({ ...editor, address: t })}
                placeholder="Street, City"
                placeholderTextColor={Colors.textPlaceholder}
              />
            </>
          )}
        </Card>
        <View style={styles.formActions}>
          <View style={{ flex: 1 }} />
          <Pressable style={styles.ghostBtn} disabled={busy} onPress={() => setEditor(null)}>
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.saveBtn, busy && { opacity: 0.7 }]} disabled={busy} onPress={save}>
            <Text style={styles.saveText}>{busy ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    );
  }

  // ── Tree ──
  return (
    <View>
      <View style={styles.toolbar}>
        <SectionTitle>Company → Brand → Branch</SectionTitle>
        <View style={styles.toolbarBtns}>
          {tree.companies.length === 0 && (
            <Pressable style={styles.ghostBtn} disabled={busy} onPress={migrate}>
              <Text style={styles.ghostText}>Migrate Qui</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.addBtn}
            onPress={() => setEditor({ kind: "company", id: "", name: "", code: "", isNew: true })}
          >
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
            <Text style={styles.addText}>Company</Text>
          </Pressable>
        </View>
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {tree.companies.length === 0 ? (
        <Text style={styles.empty}>No companies yet. Add one, or “Migrate Qui” to seed the existing branches.</Text>
      ) : (
        tree.companies.map((c) => (
          <Card key={c.id}>
            <Row
              icon="office-building"
              name={c.name}
              code={c.code}
              onEdit={() => setEditor({ kind: "company", id: c.id, name: c.name, code: c.code, isNew: false })}
              onDelete={() => runDelete(() => deleteCompany(c.id))}
              onAdd={() => setEditor({ kind: "brand", id: "", name: "", code: "", companyId: c.id, isNew: true })}
              addLabel="Brand"
            />
            {(brandsByCompany.get(c.id) ?? []).map((br) => (
              <View key={br.id} style={styles.brandBlock}>
                <Row
                  icon="tag-outline"
                  indent={1}
                  name={br.name}
                  code={br.code}
                  onEdit={() => setEditor({ kind: "brand", id: br.id, name: br.name, code: br.code, companyId: c.id, isNew: false })}
                  onDelete={() => runDelete(() => deleteBrand(c.id, br.id))}
                  onAdd={() => setEditor({ kind: "branch", id: "", name: "", code: "", companyId: c.id, brandId: br.id, address: "", isNew: true })}
                  addLabel="Branch"
                />
                {(branchesByBrand.get(br.id) ?? []).map((bx) => (
                  <Row
                    key={bx.id}
                    icon="storefront-outline"
                    indent={2}
                    name={bx.name}
                    code={bx.address || bx.code}
                    onEdit={() =>
                      setEditor({ kind: "branch", id: bx.id, name: bx.name, code: bx.code, companyId: c.id, brandId: br.id, address: bx.address, isNew: false })
                    }
                    onDelete={() => runDelete(() => deleteBranch(c.id, br.id, bx.id))}
                  />
                ))}
              </View>
            ))}
          </Card>
        ))
      )}
    </View>
  );
}

function Row({
  icon,
  name,
  code,
  indent = 0,
  addLabel,
  onEdit,
  onDelete,
  onAdd,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  name: string;
  code: string;
  indent?: number;
  addLabel?: string;
  onEdit: () => void;
  onDelete: () => void;
  onAdd?: () => void;
}) {
  return (
    <View style={[styles.row, { marginLeft: indent * 18 }, indent > 0 && styles.rowChild]}>
      <MaterialCommunityIcons name={icon} size={18} color={indent === 0 ? Colors.primary : Colors.textMuted} />
      <View style={styles.grow}>
        <Text style={[styles.rowName, indent === 0 && styles.rowNameTop]} numberOfLines={1}>{name}</Text>
        {code ? <Text style={styles.rowCode} numberOfLines={1}>{code}</Text> : null}
      </View>
      {onAdd && (
        <Pressable style={styles.miniBtn} onPress={onAdd}>
          <MaterialCommunityIcons name="plus" size={15} color={Colors.primaryDark} />
          <Text style={styles.miniText}>{addLabel}</Text>
        </Pressable>
      )}
      <Pressable style={styles.iconBtn} onPress={onEdit}>
        <MaterialCommunityIcons name="pencil-outline" size={17} color={Colors.textMuted} />
      </Pressable>
      <Pressable style={styles.iconBtn} onPress={onDelete}>
        <MaterialCommunityIcons name="trash-can-outline" size={17} color={Colors.danger} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  toolbarBtns: { flexDirection: "row", gap: 8, marginBottom: 14 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: Colors.primary },
  addText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  empty: { color: Colors.textFaint, fontSize: 14, paddingVertical: 30, textAlign: "center" },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowChild: { borderTopWidth: 1, borderTopColor: Colors.hairline },
  grow: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  rowNameTop: { fontSize: 15, fontWeight: "700" },
  rowCode: { fontSize: 12, color: Colors.textFaint, marginTop: 1 },
  brandBlock: {},
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  miniText: { fontSize: 12, fontWeight: "700", color: Colors.primaryDark },
  iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.warmSurface },

  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  backText: { color: Colors.textMuted, fontWeight: "600", fontSize: 13 },
  label: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 6, marginTop: 10 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary },
  formActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  ghostBtn: { height: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  ghostText: { color: Colors.primaryDark, fontWeight: "700", fontSize: 13 },
  saveBtn: { height: 44, paddingHorizontal: 26, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  message: { marginBottom: 12, color: Colors.textMuted, fontWeight: "600", fontSize: 13 },
});
