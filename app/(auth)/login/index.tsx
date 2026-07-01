import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { Colors } from "@/constants/theme";
import { useSession } from "@/contexts/session-context";
import { useResponsiveInset } from "@/hooks/use-responsive";
import { AUTH_ERRORS, onAuthChange, signIn, signOutUser } from "@/lib/auth";

export default function LoginScreen() {
  const router = useRouter();
  const inset = useResponsiveInset(24);
  const { setEmployee } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<"id" | "password" | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [restoring, setRestoring] = useState(true);

  // Restore a remembered session on launch via Firebase Auth state.
  useEffect(() => {
    const unsub = onAuthChange((profile) => {
      if (profile && profile.accessRole === "staff") {
        setEmployee(profile);
        router.replace("/employee/dashboard");
      } else if (profile && Platform.OS === "web") {
        // Managers/admins use the web Manager Portal (which lives in this same app).
        setEmployee(profile);
        router.replace("/manager" as never);
      } else if (profile) {
        // A manager/admin session restored on a phone — the mobile app is staff-only.
        signOutUser().catch(() => null);
        setErrorMessage("This is a manager account. Please use the web Manager Portal.");
        setRestoring(false);
      } else {
        setRestoring(false);
      }
    });
    return unsub;
  }, [router, setEmployee]);

  const onSignIn = async () => {
    if (isSigningIn) return;
    try {
      setIsSigningIn(true);
      setErrorMessage("");
      const profile = await signIn(identifier, password, rememberMe);

      // Managers/admins → web Manager Portal. On a phone the app is staff-only.
      if (profile.accessRole !== "staff") {
        if (Platform.OS === "web") {
          setEmployee(profile);
          router.replace("/manager" as never);
          return;
        }
        await signOutUser();
        setErrorMessage("This is a manager account. Please use the web Manager Portal to sign in.");
        return;
      }

      setEmployee(profile);
      router.replace("/employee/dashboard");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setErrorMessage(
        code === AUTH_ERRORS.NOT_FOUND
          ? "No account found for that ID/email."
          : code === AUTH_ERRORS.WRONG_PASSWORD
            ? "Incorrect password. Please try again."
            : code === AUTH_ERRORS.OFFLINE
              ? "Can't reach the server. Check your internet connection."
              : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  if (restoring) {
    return (
      <View style={[styles.screen, styles.center]}>
        <AmbientTop height={320} />
        <KitchenMark size={84} />
        <Text style={styles.restoreText}>Loading…</Text>
      </View>
    );
  }

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
            <Text style={styles.tagline}>PAN-ASIAN BRASSERIE</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.welcomeTitle}>Welcome back</Text>
          <Text style={styles.welcomeSubtitle}>Sign in to start your shift.</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Employee ID or Email</Text>
            <View style={[styles.inputWrap, focusedField === "id" && styles.inputWrapFocused]}>
              <Ionicons
                name="person-outline"
                size={18}
                color={focusedField === "id" ? Colors.primary : Colors.textFaint}
              />
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="e.g. EMP-1027 or you@qui.local"
                placeholderTextColor={Colors.textPlaceholder}
                autoCapitalize="none"
                onFocus={() => setFocusedField("id")}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View style={[styles.inputWrap, focusedField === "password" && styles.inputWrapFocused]}>
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={focusedField === "password" ? Colors.primary : Colors.textFaint}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={Colors.textPlaceholder}
                secureTextEntry={!showPassword}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                onSubmitEditing={onSignIn}
              />
              <Pressable onPress={() => setShowPassword((prev) => !prev)} hitSlop={10}>
                <Ionicons
                  name={showPassword ? "eye-outline" : "eye-off-outline"}
                  size={19}
                  color={Colors.textFaint}
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
              <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
                {rememberMe && <Ionicons name="checkmark" size={12} color="#ffffff" />}
              </View>
              <Text style={styles.rememberText}>Remember me</Text>
            </Pressable>
          </View>

          <TouchableOpacity
            style={[styles.signInBtn, isSigningIn && styles.signInBtnDisabled]}
            onPress={onSignIn}
            disabled={isSigningIn}
            activeOpacity={0.9}
          >
            <Text style={styles.signInBtnText}>{isSigningIn ? "Signing In..." : "Sign In"}</Text>
            {!isSigningIn && <Ionicons name="arrow-forward" size={18} color="#ffffff" />}
          </TouchableOpacity>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.signupRow}>
            <Text style={styles.signupHint}>New here?</Text>
            <Pressable onPress={() => router.push("/signup" as never)} hitSlop={6}>
              <Text style={styles.signupLink}>Create a staff account</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerWrap}>
          <Text style={styles.footerText}>© 2026 Qui · v1.0.0</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  restoreText: {
    color: Colors.textSubtle,
    fontSize: 13,
    fontWeight: "600",
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
    color: Colors.primary,
    letterSpacing: 2,
  },
  tagline: {
    color: Colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 3,
    fontWeight: "600",
  },
  card: {
    backgroundColor: Colors.cardSurface,
    borderRadius: 24,
    padding: 28,
    shadowColor: Colors.shadowWarm,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
    elevation: 6,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: -0.6,
  },
  welcomeSubtitle: {
    marginTop: 6,
    marginBottom: 24,
    color: Colors.textSubtle,
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
    color: Colors.textBody,
    letterSpacing: 0.2,
  },
  inputWrap: {
    height: 52,
    borderRadius: 12,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inputWrapFocused: {
    backgroundColor: Colors.cardSurface,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  input: {
    flex: 1,
    height: "100%",
    color: Colors.textPrimary,
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
    borderColor: Colors.textPlaceholder,
    backgroundColor: Colors.cardSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  rememberText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: "500",
  },
  signInBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: Colors.primary,
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
    color: Colors.danger,
    fontWeight: "600",
  },
  signupRow: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  signupHint: {
    fontSize: 13,
    color: Colors.textSubtle,
  },
  signupLink: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: "700",
  },
  footerWrap: {
    marginTop: 32,
    alignItems: "center",
  },
  footerText: {
    textAlign: "center",
    color: Colors.textFaint,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
});
