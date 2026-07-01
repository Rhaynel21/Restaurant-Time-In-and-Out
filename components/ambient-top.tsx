import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";

type Props = {
  /** Total height of the gradient band. Defaults to 320. */
  height?: number;
  /** Starting opacity of the brand-red wash (0..1). Defaults to 0.08. */
  intensity?: number;
};

/**
 * Decorative top wash that fades the brand-red tint from a soft starting
 * opacity to fully transparent, so there is no visible seam between the
 * tinted area and the cream canvas below.
 */
export function AmbientTop({ height = 320, intensity = 0.08 }: Props) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[
        `rgba(10, 10, 10, ${intensity})`,
        "rgba(10, 10, 10, 0)",
      ]}
      style={[styles.gradient, { height }]}
    />
  );
}

const styles = StyleSheet.create({
  gradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
});
