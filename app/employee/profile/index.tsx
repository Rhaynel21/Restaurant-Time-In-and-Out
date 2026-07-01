import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BottomNav } from "@/components/bottom-nav";
import { BrandTitle } from "@/components/brand-title";
import { useSession } from "@/contexts/session-context";
import { clearLocalSession } from "@/lib/attendance";
import { signOutUser } from "@/lib/auth";

export default function ProfileScreen() {
  const router = useRouter();
  const { employee, setEmployee } = useSession();

  const user = {
    name: employee?.fullName ?? "Alfred Cabato",
    phone: employee?.phone ?? "+63 917 555 0101",
    email: employee?.email ?? "alfred.cabato@qui.local",
    role: employee?.role ?? "Line Cook",
    branch: employee?.branchName ?? "Qui - BGC",
    employeeId: employee?.employeeId ?? "EMP-0001",
  };

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.heroBanner}>
          <View style={styles.bannerOverlay} />

          <View style={styles.topBar}>
            <BrandTitle size={28} variant="onPrimary" />
            <TouchableOpacity style={styles.topBarBtn}>
              <Ionicons name="settings-outline" size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.avatarRing}>
          <View style={styles.avatarInner}>
            <Text style={styles.avatarInitials}>
              {user.name
                .split(" ")
                .slice(0, 2)
                .map((n) => n[0])
                .join("")
                .toUpperCase()}
            </Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={styles.statusBadgeDot} />
          </View>
        </View>

        <View style={styles.identitySection}>
          <Text style={styles.userName}>{user.name}</Text>
          <View style={styles.rolePill}>
            <Ionicons name="briefcase-outline" size={11} color="#0A0A0A" />
            <Text style={styles.roleText}>{user.role}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <InfoRow icon="badge-account-outline" label="Employee ID" value={user.employeeId} />
          <View style={styles.divider} />
          <InfoRow icon="email-outline" label="Email" value={user.email} />
          <View style={styles.divider} />
          <InfoRow icon="phone-outline" label="Phone" value={user.phone} />
          <View style={styles.divider} />
          <InfoRow icon="map-marker-outline" label="Branch" value={user.branch} />
        </View>

        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.menuCard}>
          <MenuItem icon="pencil-outline" label="Edit Profile" onPress={() => {}} />
          <View style={styles.divider} />
          <MenuItem icon="bell-outline" label="Notifications" onPress={() => {}} />
          <View style={styles.divider} />
          <MenuItem icon="shield-check-outline" label="Privacy & Security" onPress={() => {}} />
          <View style={styles.divider} />
          <MenuItem icon="information-outline" label="About" onPress={() => {}} />
        </View>

        <View style={styles.menuCard}>
          <MenuItem
            icon="logout"
            label="Log Out"
            danger
            onPress={() => {
              signOutUser().catch(() => null);
              clearLocalSession().catch(() => null);
              setEmployee(null);
              router.replace("/(auth)");
            }}
          />
        </View>

        <Text style={styles.copyright}>© 2026 Qui · v1.0.0</Text>
      </ScrollView>

      <BottomNav active="profile" />
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconWrap}>
        <MaterialCommunityIcons name={icon} size={18} color="#6B6B6B" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  danger = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.6}>
      <View style={[styles.menuIconWrap, danger && styles.menuIconDanger]}>
        <MaterialCommunityIcons name={icon} size={18} color={danger ? "#B23A3A" : "#6B6B6B"} />
      </View>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={danger ? "#B23A3A" : "#C4C4C4"} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F5F0",
  },
  scroll: {
    paddingBottom: 130,
    alignItems: "center",
  },
  heroBanner: {
    width: "100%",
    height: 200,
    backgroundColor: "#0A0A0A",
    overflow: "hidden",
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#2A2A2A",
    opacity: 0.4,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  topBarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  avatarRing: {
    marginTop: -54,
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  avatarInner: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#9A7B3F",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 30,
    fontWeight: "700",
    color: "#0A0A0A",
    letterSpacing: -0.5,
  },
  statusBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  statusBadgeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#2F6B4F",
  },
  identitySection: {
    alignItems: "center",
    marginTop: 14,
    marginBottom: 24,
    gap: 8,
  },
  userName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#141414",
    letterSpacing: -0.4,
  },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "rgba(10, 10, 10, 0.05)",
    borderRadius: 12,
  },
  roleText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0A0A0A",
  },
  infoCard: {
    width: "88%",
    maxWidth: 460,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 4,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#EAE6DD",
    alignItems: "center",
    justifyContent: "center",
  },
  infoLabel: {
    fontSize: 11,
    color: "#A8A8A8",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#141414",
    marginTop: 2,
  },
  sectionLabel: {
    width: "88%",
    maxWidth: 460,
    fontSize: 11,
    fontWeight: "700",
    color: "#8A8A8A",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },
  menuCard: {
    width: "88%",
    maxWidth: 460,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 4,
    shadowColor: "#141414",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: "rgba(10, 10, 10, 0.04)",
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 14,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#EAE6DD",
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconDanger: {
    backgroundColor: "rgba(178, 58, 58, 0.08)",
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#141414",
  },
  menuLabelDanger: {
    color: "#B23A3A",
  },
  divider: {
    height: 1,
    backgroundColor: "#EAE6DD",
    marginHorizontal: 14,
  },
  copyright: {
    marginTop: 20,
    fontSize: 11,
    color: "#A8A8A8",
    textAlign: "center",
    fontWeight: "500",
    letterSpacing: 0.3,
  },
});

