import { StyleSheet, Text, View } from "react-native";

import { KitchenMark } from "@/components/kitchen-mark";
import { Colors } from "@/constants/theme";

type Variant = "light" | "onPrimary";

type Props = {
  /** Icon diameter in px. Defaults to 30. */
  size?: number;
  /** "light" = green text for light surfaces; "onPrimary" = light text for the green banner. */
  variant?: Variant;
};

export function BrandTitle({ size = 30, variant = "light" }: Props) {
  const isOnPrimary = variant === "onPrimary";
  return (
    <View style={styles.row}>
      <KitchenMark size={size} />
      <Text style={[styles.text, isOnPrimary ? styles.textOnPrimary : styles.textLight]}>
        Thyme In
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  text: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  textLight: {
    color: Colors.primary,
  },
  textOnPrimary: {
    color: Colors.textOnDark,
  },
});
