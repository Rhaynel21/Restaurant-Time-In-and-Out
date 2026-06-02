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
import { KitchenMark } from "@/components/kitchen-mark";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { OFFLINE_LOGIN_CACHE_MISS, ensureEmployeeProfile } from "@/lib/attendance";

export default function LoginScreen() {
  const router = useRouter();
  const inset = useResponsiveInset(24);
  const { setEmployee, setSelectedBranch } = useSession();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<"id" | "password" | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const onSignIn = async () => {
    try {
      setIsSigningIn(true);
      setErrorMessage("");
      const profile = await ensureEmployeeProfile(employeeId);
      setEmployee(profile);
      setSelectedBranch(null);
      router.replace("/select-branch");
    } catch (error) {
      const isOfflineCacheMiss =
        error instanceof Error && error.message === OFFLINE_LOGIN_CACHE_MISS;
      setErrorMessage(
        isOfflineCacheMiss
          ? "Offline login unavailable for this ID. Sign in once while online first."
          : "Unable to reach cloud. If this account logged in before, offline mode will still work.",
      );
      console.error(error);
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screen}
    >
      <AmbientTop height={320} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: inset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandWrap}>
          <KitchenMark size={104} />
          <View style={styles.wordmarkWrap}>
            <Text style={styles.wordmark}>THYME IN</Text>
            <Text style={styles.tagline}>Kitchen Crew Time Clock</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.welcomeTitle}>Welcome back</Text>
          <Text style={styles.welcomeSubtitle}>
            Sign in to start your shift.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Employee ID</Text>
            <View
              style={[
                styles.inputWrap,
                focusedField === "id" && styles.inputWrapFocused,
              ]}
            >
              <Ionicons
                name="person-outline"
                size={18}
                color={focusedField === "id" ? "#059669" : "#8FA89A"}
              />
              <TextInput
                style={styles.input}
                value={employeeId}
                onChangeText={setEmployeeId}
                placeholder="e.g. EMP-1027"
                placeholderTextColor="#B0C8B8"
                autoCapitalize="characters"
                onFocus={() => setFocusedField("id")}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View
              style={[
                styles.inputWrap,
                focusedField === "password" && styles.inputWrapFocused,
              ]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={focusedField === "password" ? "#059669" : "#8FA89A"}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#B0C8B8"
                secureTextEntry={!showPassword}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
              />
              <Pressable
                onPress={() => setShowPassword((prev) => !prev)}
                hitSlop={10}
              >
                <Ionicons
                  name={showPassword ? "eye-outline" : "eye-off-outline"}
                  size={19}
                  color="#8FA89A"
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.optionsRow}>
            <Pressable
              onPress={() => setRememberMe((prev) => !prev)}
              style={styles.rememberRow}
              hitSlop={6}
            >
              <View
                style={[
                  styles.checkbox,
                  rememberMe && styles.checkboxOn,
                ]}
              >
                {rememberMe && (
                  <Ionicons name="checkmark" size={12} color="#ffffff" />
                )}
              </View>
              <Text style={styles.rememberText}>Remember me</Text>
            </Pressable>
            <Pressable hitSlop={6}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </View>

          <TouchableOpacity
            style={[styles.signInBtn, isSigningIn && styles.signInBtnDisabled]}
            onPress={onSignIn}
            disabled={isSigningIn}
            activeOpacity={0.9}
          >
            <Text style={styles.signInBtnText}>
              {isSigningIn ? "Signing In..." : "Sign In"}
            </Text>
            {!isSigningIn && <Ionicons name="arrow-forward" size={18} color="#ffffff" />}
          </TouchableOpacity>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </View>

        <View style={styles.footerWrap}>
          <Text style={styles.footerText}>
            © 2026 Thyme In · v1.0.0
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F2FBF6",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 48,
  },
  brandWrap: {
    alignItems: "center",
    marginBottom: 36,
    gap: 16,
  },
  wordmarkWrap: {
    alignItems: "center",
    gap: 6,
  },
  wordmark: {
    fontSize: 28,
    fontWeight: "800",
    color: "#059669",
    letterSpacing: 2,
  },
  tagline: {
    color: "#44604F",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 3,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 28,
    shadowColor: "#0B2A1E",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(11, 42, 30, 0.04)",
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#0B2A1E",
    letterSpacing: -0.6,
  },
  welcomeSubtitle: {
    marginTop: 6,
    marginBottom: 24,
    color: "#5A7264",
    fontSize: 14,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 16,
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1E3A2C",
    letterSpacing: 0.2,
  },
  inputWrap: {
    height: 52,
    borderRadius: 12,
    backgroundColor: "#E7F7EF",
    borderWidth: 1,
    borderColor: "#C6E8D5",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputWrapFocused: {
    backgroundColor: "#ffffff",
    borderColor: "#059669",
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  input: {
    flex: 1,
    height: "100%",
    color: "#0B2A1E",
    fontSize: 15,
    fontWeight: "500",
  },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 22,
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#B0C8B8",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    borderColor: "#059669",
    backgroundColor: "#059669",
  },
  rememberText: {
    fontSize: 13,
    color: "#44604F",
    fontWeight: "500",
  },
  forgotText: {
    fontSize: 13,
    color: "#059669",
    fontWeight: "600",
  },
  signInBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: "#059669",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  signInBtnDisabled: {
    opacity: 0.8,
  },
  signInBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 15,
    letterSpacing: 0.2,
  },
  errorText: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 12,
    color: "#B91C1C",
    fontWeight: "600",
  },
  footerWrap: {
    marginTop: 32,
    alignItems: "center",
  },
  footerText: {
    textAlign: "center",
    color: "#8FA89A",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
});
