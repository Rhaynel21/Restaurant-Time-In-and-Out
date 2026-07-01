import { Image, View } from "react-native";

import { Colors } from "@/constants/theme";

type Props = {
  /** Logo tile diameter in px. Defaults to 96. */
  size?: number;
};

/**
 * Qui brand mark — the "qui" wordmark seal on an ivory tile.
 */
export function KitchenMark({ size = 96 }: Props) {
  const radius = Math.round(size * 0.22);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: Colors.cardSurface,
        borderWidth: 1,
        borderColor: Colors.warmBorder,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Image
        source={require("@/assets/images/logo.png")}
        style={{ width: size * 0.92, height: size * 0.92 }}
        resizeMode="contain"
      />
    </View>
  );
}
