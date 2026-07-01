import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { AmbientTop } from "@/components/ambient-top";
import { Colors } from "@/constants/theme";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AUTH_ERRORS, signUp } from "@/lib/auth";
import { BRANCHES } from "@/lib/branches";

export default function SignUpScreen() {
  const router = useRouter();
  const inset = useResponsiveInset(24);
  const { setEmployee } = useSession();

  const [fullName, setFullName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [branchId, setBranchId] = useState(BRANCHES[0].id);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    if (submitting) return;
    setError("");

    if (!fullName.trim() || !employeeId.trim() || !email.trim() || !password) {
      setError("Please fill in name, Employee ID, email, and password.");
      return;
    }
    if (!email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);
      const branch = BRANCHES.find((b) => b.id === branchId) ?? null;
      const profile = await signUp({
        employeeId,
        fullName,
        email,
        phone,
        position,
        password,
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
      });
      setEmployee(profile);
      router.replace("/employee/dashboard");
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(
        code === AUTH_ERRORS.EXISTS
          ? "An account with that Employee ID or email already exists."
          : code === AUTH_ERRORS.OFFLINE
            ? "Can't reach the server. Check your internet connection."
            : "Unable to create account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screen}
    >
      <AmbientTop height={260} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: inset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={Colors.textPrimary} />
          </Pressable>
        </View>

        <Text style={styles.title}>Create staff account</Text>
        <Text style={styles.subtitle}>Sign up to clock in and file leave requests.</Text>

        <View style={styles.card}>
          <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Juan Dela Cruz" />
          <Field
            label="Employee ID"
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="EMP-1027"
            autoCapitalize="characters"
          />
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            placeholder="you@qui.local"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Field label="Phone (optional)" value={phone} onChange={setPhone} placeholder="+63 917 000 0000" keyboardType="phone-pad" />
          <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="Line Cook" />

          <Text style={styles.fieldLabel}>Branch</Text>
          <View style={styles.branchRow}>
            {BRANCHES.map((b) => {
              const active = b.id === branchId;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setBranchId(b.id)}
                  style={[styles.branchChip, active && styles.branchChipActive]}
                >
                  <Text style={[styles.branchChipText, active && styles.branchChipTextActive]}>
                    {b.name.replace("Qui - ", "")}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Password</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={Colors.textFaint} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={Colors.textPlaceholder}
              secureTextEntry={!showPassword}
            />
            <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={10}>
              <Ionicons
                name={showPassword ? "eye-outline" : "eye-off-outline"}
                size={19}
                color={Colors.textFaint}
              />
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>Confirm password</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={Colors.textFaint} />
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Re-enter your password"
              placeholderTextColor={Colors.textPlaceholder}
              secureTextEntry={!showPassword}
              onSubmitEditing={onSubmit}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={onSubmit}
            disabled={submitting}
            activeOpacity={0.9}
          >
            <Text style={styles.submitBtnText}>{submitting ? "Creating..." : "Create Account"}</Text>
          </TouchableOpacity>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize = "sentences",
  keyboardType = "default",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address" | "phone-pad";
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textPlaceholder}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingTop: 56, paddingBottom: 48 },
  topRow: { marginBottom: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardSurface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 20,
    color: Colors.textSubtle,
    fontSize: 14,
  },
  card: {
    backgroundColor: Colors.cardSurface,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.hairline,
    shadowColor: Colors.shadowWarm,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
    elevation: 6,
    gap: 6,
  },
  fieldGroup: { marginBottom: 10, gap: 8 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.textBody,
    marginTop: 6,
    marginBottom: 8,
  },
  inputWrap: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    height: 48,
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: "500",
  },
  branchRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  branchChip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.warmSurface,
  },
  branchChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  branchChipText: { fontSize: 13, fontWeight: "600", color: Colors.textSubtle },
  branchChipTextActive: { color: Colors.primaryDark },
  submitBtn: {
    marginTop: 18,
    height: 54,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  submitBtnDisabled: { opacity: 0.8 },
  submitBtnText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  errorText: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 12,
    color: Colors.danger,
    fontWeight: "600",
  },
});
