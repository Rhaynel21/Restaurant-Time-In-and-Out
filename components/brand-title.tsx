import { Platform, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/theme";

type Variant = "light" | "onPrimary";

type Props = {
  /** Wordmark cap height in px. Defaults to 30. */
  size?: number;
  /** "light" = ink wordmark for light surfaces; "onPrimary" = ivory wordmark for the dark banner. */
  variant?: Variant;
  /** Show the "Pan-Asian Brasserie" kicker beneath the wordmark. Defaults to true. */
  tagline?: boolean;
};

const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" });

/**
 * Qui wordmark — lowercase high-contrast serif, with an optional spaced
 * "PAN-ASIAN BRASSERIE" kicker. Pure type, no raster asset.
 */
export function BrandTitle({ size = 30, variant = "light", tagline = true }: Props) {
  const isOnPrimary = variant === "onPrimary";
  const ink = isOnPrimary ? Colors.textOnDark : Colors.textPrimary;
  const sub = isOnPrimary ? "rgba(247,245,240,0.7)" : Colors.textSubtle;
  return (
    <View style={styles.col}>
      <Text style={[styles.word, { fontSize: size, color: ink }]}>qui</Text>
      {tagline ? (
        <Text style={[styles.kicker, { fontSize: Math.max(8, size * 0.26), color: sub }]}>
          PAN-ASIAN BRASSERIE
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  col: {
    alignItems: "flex-start",
  },
  word: {
    fontFamily: SERIF,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: undefined,
  },
  kicker: {
    fontFamily: SERIF,
    fontWeight: "500",
    letterSpacing: 3,
    marginTop: 2,
  },
});
