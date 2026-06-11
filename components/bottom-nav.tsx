import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/theme";
import { useResponsiveInset } from "@/hooks/use-responsive";

export type TabKey = "home" | "history" | "leave" | "profile";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type Tab = {
  key: TabKey;
  label: string;
  icon: IoniconName;
  activeIcon: IoniconName;
  href: string;
};

const TABS: Tab[] = [
  {
    key: "home",
    label: "Home",
    icon: "home-outline",
    activeIcon: "home",
    href: "/employee/dashboard",
  },
  {
    key: "history",
    label: "History",
    icon: "calendar-outline",
    activeIcon: "calendar",
    href: "/employee/history",
  },
  {
    key: "leave",
    label: "Leave",
    icon: "airplane-outline",
    activeIcon: "airplane",
    href: "/employee/leave",
  },
  {
    key: "profile",
    label: "Profile",
    icon: "person-circle-outline",
    activeIcon: "person",
    href: "/employee/profile",
  },
];

export function BottomNav({ active }: { active: TabKey }) {
  const router = useRouter();
  const inset = useResponsiveInset(18);

  return (
    <View style={[styles.bar, { left: inset, right: inset }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        if (isActive) {
          return (
            <View key={tab.key} style={styles.activeTab}>
              <Ionicons name={tab.activeIcon} size={16} color={Colors.textOnDark} />
              <Text style={styles.activeTabText}>{tab.label}</Text>
            </View>
          );
        }
        return (
          <Pressable
            key={tab.key}
            style={styles.tabButton}
            onPress={() => router.replace(tab.href as never)}
            android_ripple={{ color: "rgba(255,255,255,0.08)", borderless: true }}
            hitSlop={6}
          >
            <Ionicons name={tab.icon} size={22} color={Colors.textOnDark} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 22,
    height: 64,
    borderRadius: 32,
    paddingHorizontal: 8,
    backgroundColor: Colors.darkSurface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "rgba(255, 248, 236, 0.06)",
    shadowColor: Colors.darkSurface,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  activeTab: {
    height: 48,
    minWidth: 112,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  activeTabText: {
    color: Colors.textOnDark,
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  tabButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
