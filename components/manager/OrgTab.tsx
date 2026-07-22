import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BackLink, Button, Card, Field, IconButton, InlineMessage, SectionTitle, Select, TextField } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import {
  Area,
  Branch,
  Brand,
  EMPTY_ORG,
  OrgTree,
  deleteArea,
  deleteBranch,
  deleteBrand,
  deleteCompany,
  migrateQuiOrg,
  saveArea,
  saveBranch,
  saveBrand,
  saveCompany,
  subscribeOrgTree,
} from "@/lib/org";

type Editor =
  | { kind: "company"; id: string; name: string; code: string; isNew: boolean }
  | { kind: "brand"; id: string; name: string; code: string; companyId: string; isNew: boolean }
  | { kind: "area"; id: string; name: string; code: string; companyId: string; isNew: boolean }
  | {
      kind: "branch";
      id: string;
      name: string;
      code: string;
      companyId: string;
      brandId: string;
      address: string;
      latitude: string;
      longitude: string;
      radiusMeters: string;
      areaId: string;
      posBranchId: string;
      isNew: boolean;
    };

function slug(s: string) {
  return s.trim().toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

// Parse a lat/lng text field → number, or null when blank/invalid.
function parseCoord(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function OrgTab() {
  const [tree, setTree] = useState<OrgTree>(EMPTY_ORG);
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
  const areasByCompany = useMemo(() => {
    const m = new Map<string, Area[]>();
    tree.areas.forEach((a) => m.set(a.companyId, [...(m.get(a.companyId) ?? []), a]));
    return m;
  }, [tree.areas]);

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
      else if (editor.kind === "area")
        await saveArea({ id, name: editor.name.trim(), code: editor.code.trim(), companyId: editor.companyId });
      else {
        const area = editor.areaId ? tree.areas.find((a) => a.id === editor.areaId) ?? null : null;
        await saveBranch({
          id,
          name: editor.name.trim(),
          code: editor.code.trim(),
          companyId: editor.companyId,
          brandId: editor.brandId,
          address: editor.address.trim(),
          latitude: parseCoord(editor.latitude),
          longitude: parseCoord(editor.longitude),
          radiusMeters: parseCoord(editor.radiusMeters),
          areaId: area?.id ?? null,
          areaName: area?.name ?? null,
          posBranchId: editor.posBranchId.trim() || null,
        });
      }
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
        <BackLink label="Back to organization" onPress={() => setEditor(null)} />
        <SectionTitle>
          {editor.isNew ? "New" : "Edit"} {editor.kind}
        </SectionTitle>
        <Card>
          <TextField
            label="Name"
            value={editor.name}
            onChangeText={(t) => setEditor({ ...editor, name: t })}
            placeholder={editor.kind === "company" ? "Jollibee Foods Corp" : editor.kind === "brand" ? "Jollibee" : "Jollibee — Makati"}
          />
          <TextField
            label="Code"
            value={editor.code}
            onChangeText={(t) => setEditor({ ...editor, code: t })}
            placeholder="Short code (e.g. JFC)"
          />
          {editor.kind === "branch" && (
            <>
              <TextField
                label="Address"
                value={editor.address ?? ""}
                onChangeText={(t) => setEditor({ ...editor, address: t })}
                placeholder="Street, City"
              />
              <Field label="Area">
                <Select
                  value={editor.areaId}
                  onChange={(v) => setEditor({ ...editor, areaId: v })}
                  placeholder="— None —"
                  options={[
                    { value: "", label: "— None —" },
                    ...(areasByCompany.get(editor.companyId) ?? []).map((a) => ({ value: a.id, label: a.name })),
                  ]}
                />
              </Field>
              <View style={styles.coordRow}>
                <View style={styles.coordCol}>
                  <TextField
                    label="Latitude"
                    value={editor.latitude}
                    onChangeText={(t) => setEditor({ ...editor, latitude: t })}
                    placeholder="14.5995"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.coordCol}>
                  <TextField
                    label="Longitude"
                    value={editor.longitude}
                    onChangeText={(t) => setEditor({ ...editor, longitude: t })}
                    placeholder="120.9842"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.coordCol}>
                  <TextField
                    label="Geofence radius (m)"
                    value={editor.radiusMeters}
                    onChangeText={(t) => setEditor({ ...editor, radiusMeters: t })}
                    placeholder="150"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <Text style={styles.coordHint}>Lat/lng + radius define the mobile app&apos;s GPS check-in geofence.</Text>
              <TextField
                label="POS branch ID (Phase 1 link)"
                value={editor.posBranchId}
                onChangeText={(t) => setEditor({ ...editor, posBranchId: t })}
                placeholder="restaurant-management-96e52 branchId"
                hint="Links this branch to the Klicc POS for revenue + service-charge feeds."
              />
            </>
          )}
        </Card>
        <View style={styles.formActions}>
          <View style={{ flex: 1 }} />
          <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => setEditor(null)} />
          <Button label={busy ? "Saving…" : "Save"} loading={busy} onPress={save} />
        </View>
        {message ? <View style={{ marginTop: 12 }}><InlineMessage text={message} tone="info" /></View> : null}
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
            <Button label="Migrate Qui" variant="ghost" size="sm" disabled={busy} onPress={migrate} />
          )}
          <Button label="Company" size="sm" icon="plus" onPress={() => setEditor({ kind: "company", id: "", name: "", code: "", isNew: true })} />
        </View>
      </View>
      {message ? <View style={{ marginBottom: 12 }}><InlineMessage text={message} tone="info" /></View> : null}

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
                  onAdd={() =>
                    setEditor({ kind: "branch", id: "", name: "", code: "", companyId: c.id, brandId: br.id, address: "", latitude: "", longitude: "", radiusMeters: "", areaId: "", posBranchId: "", isNew: true })
                  }
                  addLabel="Branch"
                />
                {(branchesByBrand.get(br.id) ?? []).map((bx) => (
                  <Row
                    key={bx.id}
                    icon="storefront-outline"
                    indent={2}
                    name={bx.name}
                    code={[bx.areaName, bx.address || bx.code].filter(Boolean).join(" · ")}
                    onEdit={() =>
                      setEditor({
                        kind: "branch",
                        id: bx.id,
                        name: bx.name,
                        code: bx.code,
                        companyId: c.id,
                        brandId: br.id,
                        address: bx.address,
                        latitude: bx.latitude == null ? "" : String(bx.latitude),
                        longitude: bx.longitude == null ? "" : String(bx.longitude),
                        radiusMeters: bx.radiusMeters == null ? "" : String(bx.radiusMeters),
                        areaId: bx.areaId ?? "",
                        posBranchId: bx.posBranchId ?? "",
                        isNew: false,
                      })
                    }
                    onDelete={() => runDelete(() => deleteBranch(c.id, br.id, bx.id))}
                  />
                ))}
              </View>
            ))}
            {/* Areas — org-scoped groupings assigned to branches (Phase-1-aligned) */}
            <View style={styles.areaBlock}>
              <View style={styles.areaHead}>
                <Text style={styles.areaHeadLabel}>Areas / Regions</Text>
                <Button
                  label="Area"
                  variant="subtle"
                  size="sm"
                  icon="plus"
                  onPress={() => setEditor({ kind: "area", id: "", name: "", code: "", companyId: c.id, isNew: true })}
                />
              </View>
              {(areasByCompany.get(c.id) ?? []).map((a) => (
                <Row
                  key={a.id}
                  icon="map-marker-radius-outline"
                  indent={1}
                  name={a.name}
                  code={a.code}
                  onEdit={() => setEditor({ kind: "area", id: a.id, name: a.name, code: a.code, companyId: c.id, isNew: false })}
                  onDelete={() => runDelete(() => deleteArea(c.id, a.id))}
                />
              ))}
              {(areasByCompany.get(c.id) ?? []).length === 0 ? <Text style={styles.areaEmpty}>No areas yet.</Text> : null}
            </View>
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
      {onAdd && <Button label={addLabel ?? "Add"} variant="subtle" size="sm" icon="plus" onPress={onAdd} />}
      <IconButton icon="pencil-outline" onPress={onEdit} />
      <IconButton icon="trash-can-outline" tone="danger" onPress={onDelete} />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  toolbarBtns: { flexDirection: "row", gap: 8, marginBottom: 14 },
  empty: { color: Colors.textFaint, fontSize: 14, paddingVertical: 30, textAlign: "center" },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowChild: { borderTopWidth: 1, borderTopColor: Colors.hairline },
  grow: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  rowNameTop: { fontSize: 15, fontWeight: "700" },
  rowCode: { fontSize: 12, color: Colors.textFaint, marginTop: 1 },
  brandBlock: {},
  formActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },

  areaBlock: { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.hairline },
  areaHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  areaHeadLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: Colors.textMuted },
  areaEmpty: { color: Colors.textFaint, fontSize: 12, paddingVertical: 8 },

  coordRow: { flexDirection: "row", gap: 12 },
  coordCol: { flex: 1, minWidth: 0 },
  coordHint: { fontSize: 12, color: Colors.textFaint, marginTop: 2 },
});
