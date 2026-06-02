import { StyleSheet, Text, View } from "react-native";

import { KopiklockMark } from "@/components/kopiklock-mark";
import { Colors } from "@/constants/theme";

type Variant = "light" | "onRed";

type Props = {
  /** Icon diameter in px. Defaults to 30. */
  size?: number;
  /** "light" = brand-red text for cream surfaces; "onRed" = cream text for the red banner. */
  variant?: Variant;
};

export function BrandTitle({ size = 30, variant = "light" }: Props) {
  const isOnRed = variant === "onRed";
  return (
    <View style={styles.row}>
      <KopiklockMark size={size} />
      <Text style={[styles.text, isOnRed ? styles.textOnRed : styles.textLight]}>
        Kopiklock
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
  textOnRed: {
    color: Colors.textOnDark,
  },
});
