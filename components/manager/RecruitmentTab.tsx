import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Badge, Card, EmptyState, SectionTitle, Select } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import {
  Applicant,
  ApplicantStage,
  JobPost,
  STAGES,
  createApplicant,
  createJobPost,
  setApplicantStage,
  setJobStatus,
  subscribeApplicants,
  subscribeJobPosts,
} from "@/lib/recruitment";

function stageTone(stage: ApplicantStage): "in" | "out" | "pending" | "approved" | "rejected" {
  if (stage === "hired") return "approved";
  if (stage === "rejected") return "rejected";
  if (stage === "offer") return "in";
  return "pending";
}

export function RecruitmentTab() {
  const [posts, setPosts] = useState<JobPost[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [showNewPost, setShowNewPost] = useState(false);
  const [post, setPost] = useState({ title: "", department: "", branchName: "", openings: "1", description: "" });
  const [appl, setAppl] = useState({ name: "", email: "", phone: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeJobPosts(setPosts, () => setPosts([])), []);
  useEffect(() => subscribeApplicants(setApplicants, () => setApplicants([])), []);

  const selected = posts.find((p) => p.id === selId) ?? null;
  const forPost = useMemo(() => applicants.filter((a) => a.jobPostId === selId), [applicants, selId]);
  const countFor = (postId: string) => applicants.filter((a) => a.jobPostId === postId).length;

  const addPost = async () => {
    if (!post.title.trim()) return;
    setBusy(true);
    try {
      await createJobPost({
        title: post.title.trim(),
        department: post.department.trim(),
        branchName: post.branchName.trim(),
        description: post.description.trim(),
        openings: Math.max(1, parseInt(post.openings, 10) || 1),
      });
      setPost({ title: "", department: "", branchName: "", openings: "1", description: "" });
      setShowNewPost(false);
    } finally {
      setBusy(false);
    }
  };

  const addApplicant = async () => {
    if (!selected || !appl.name.trim()) return;
    setBusy(true);
    try {
      await createApplicant({ jobPostId: selected.id, jobTitle: selected.title, name: appl.name.trim(), email: appl.email.trim(), phone: appl.phone.trim(), notes: appl.notes.trim() });
      setAppl({ name: "", email: "", phone: "", notes: "" });
    } finally {
      setBusy(false);
    }
  };

  // ── Applicant pipeline for a selected post ──
  if (selected) {
    const byStage = STAGES.map((s) => ({ ...s, n: forPost.filter((a) => a.stage === s.key).length }));
    return (
      <View>
        <Pressable style={styles.back} onPress={() => setSelId(null)}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={Colors.textMuted} />
          <Text style={styles.backText}>All job posts</Text>
        </Pressable>
        <SectionTitle>{selected.title} · Applicants</SectionTitle>

        <View style={styles.pipeline}>
          {byStage.map((s) => (
            <View key={s.key} style={styles.pipeCell}>
              <Text style={styles.pipeNum}>{s.n}</Text>
              <Text style={styles.pipeLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <Card>
          <Text style={styles.formHead}>Add applicant</Text>
          <View style={styles.grid}>
            <TextInput style={styles.input} value={appl.name} onChangeText={(t) => setAppl({ ...appl, name: t })} placeholder="Full name" placeholderTextColor={Colors.textPlaceholder} />
            <TextInput style={styles.input} value={appl.email} onChangeText={(t) => setAppl({ ...appl, email: t })} placeholder="Email" placeholderTextColor={Colors.textPlaceholder} />
            <TextInput style={styles.input} value={appl.phone} onChangeText={(t) => setAppl({ ...appl, phone: t })} placeholder="Phone" placeholderTextColor={Colors.textPlaceholder} />
          </View>
          <TextInput style={[styles.input, styles.multiline]} value={appl.notes} onChangeText={(t) => setAppl({ ...appl, notes: t })} multiline placeholder="Notes (optional)" placeholderTextColor={Colors.textPlaceholder} />
          <Pressable style={[styles.primaryBtn, busy && styles.dim]} disabled={busy} onPress={addApplicant}>
            <MaterialCommunityIcons name="account-plus-outline" size={18} color="#fff" />
            <Text style={styles.primaryText}>Add applicant</Text>
          </Pressable>
        </Card>

        {forPost.length === 0 ? (
          <EmptyState icon="account-search-outline" text="No applicants yet" />
        ) : (
          forPost.map((a) => (
            <Card key={a.id}>
              <View style={styles.applRow}>
                <View style={styles.grow}>
                  <Text style={styles.applName}>{a.name}</Text>
                  <Text style={styles.applSub} numberOfLines={1}>{[a.email, a.phone].filter(Boolean).join(" · ") || "—"}</Text>
                  {a.notes ? <Text style={styles.applNotes}>{a.notes}</Text> : null}
                </View>
                <View style={styles.stageCol}>
                  <Badge label={STAGES.find((s) => s.key === a.stage)?.label ?? a.stage} tone={stageTone(a.stage)} />
                  <Select value={a.stage} width={150} options={STAGES.map((s) => ({ value: s.key, label: s.label }))} onChange={(v) => setApplicantStage(a.id, v as ApplicantStage)} />
                </View>
              </View>
            </Card>
          ))
        )}
      </View>
    );
  }

  // ── Job posts list ──
  return (
    <View>
      <View style={styles.headerRow}>
        <SectionTitle>Job Posts</SectionTitle>
        <Pressable style={styles.addBtn} onPress={() => setShowNewPost((v) => !v)}>
          <MaterialCommunityIcons name={showNewPost ? "close" : "plus"} size={18} color="#fff" />
          <Text style={styles.addText}>{showNewPost ? "Cancel" : "New Post"}</Text>
        </Pressable>
      </View>

      {showNewPost && (
        <Card>
          <View style={styles.grid}>
            <TextInput style={styles.input} value={post.title} onChangeText={(t) => setPost({ ...post, title: t })} placeholder="Job title (e.g. Line Cook)" placeholderTextColor={Colors.textPlaceholder} />
            <TextInput style={styles.input} value={post.department} onChangeText={(t) => setPost({ ...post, department: t })} placeholder="Department" placeholderTextColor={Colors.textPlaceholder} />
            <TextInput style={styles.input} value={post.branchName} onChangeText={(t) => setPost({ ...post, branchName: t })} placeholder="Branch" placeholderTextColor={Colors.textPlaceholder} />
            <TextInput style={[styles.input, { width: 110 }]} value={post.openings} onChangeText={(t) => setPost({ ...post, openings: t.replace(/[^0-9]/g, "") })} keyboardType="numeric" placeholder="Openings" placeholderTextColor={Colors.textPlaceholder} />
          </View>
          <TextInput style={[styles.input, styles.multiline]} value={post.description} onChangeText={(t) => setPost({ ...post, description: t })} multiline placeholder="Description / requirements" placeholderTextColor={Colors.textPlaceholder} />
          <Pressable style={[styles.primaryBtn, busy && styles.dim]} disabled={busy} onPress={addPost}>
            <Text style={styles.primaryText}>Create job post</Text>
          </Pressable>
        </Card>
      )}

      {posts.length === 0 ? (
        <EmptyState icon="briefcase-outline" text="No job posts yet — create your first opening" />
      ) : (
        posts.map((p) => (
          <Card key={p.id}>
            <View style={styles.applRow}>
              <Pressable style={styles.grow} onPress={() => setSelId(p.id)}>
                <Text style={styles.applName}>{p.title}</Text>
                <Text style={styles.applSub}>{[p.department, p.branchName].filter(Boolean).join(" · ") || "—"} · {p.openings} opening{p.openings === 1 ? "" : "s"} · {countFor(p.id)} applicant{countFor(p.id) === 1 ? "" : "s"}</Text>
              </Pressable>
              <View style={styles.stageCol}>
                <Badge label={p.status === "open" ? "Open" : "Closed"} tone={p.status === "open" ? "approved" : "out"} />
                <Pressable style={styles.linkBtn} onPress={() => setJobStatus(p.id, p.status === "open" ? "closed" : "open")}>
                  <Text style={styles.linkText}>{p.status === "open" ? "Close" : "Reopen"}</Text>
                </Pressable>
              </View>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 11, backgroundColor: Colors.primary },
  addText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  backText: { color: Colors.textMuted, fontWeight: "600", fontSize: 13 },

  grid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  input: { flexGrow: 1, flexBasis: 180, minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.textPrimary, outlineStyle: "none" } as object,
  multiline: { minHeight: 64, marginTop: 10, textAlignVertical: "top", flexBasis: "100%" } as object,
  formHead: { fontSize: 13, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, backgroundColor: Colors.primary, marginTop: 12 },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  dim: { opacity: 0.6 },

  pipeline: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  pipeCell: { flexGrow: 1, flexBasis: 90, alignItems: "center", backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.hairline, borderRadius: 12, paddingVertical: 12 },
  pipeNum: { fontSize: 20, fontWeight: "800", color: Colors.textPrimary },
  pipeLabel: { fontSize: 11, color: Colors.textFaint, marginTop: 2, fontWeight: "600" },

  applRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  applName: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  applSub: { fontSize: 13, color: Colors.textFaint, marginTop: 2 },
  applNotes: { fontSize: 13, color: Colors.textMuted, marginTop: 6, lineHeight: 18 },
  stageCol: { alignItems: "flex-end", gap: 8 },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.warmBorder },
  linkText: { fontSize: 12, fontWeight: "700", color: Colors.textMuted },
});
