import { Image } from "react-native";

type Props = {
  /** Logo diameter in px. Defaults to 96. */
  size?: number;
};

/**
 * Thyme In brand mark — the chef-hat-and-clock logo.
 */
export function KitchenMark({ size = 96 }: Props) {
  return (
    <Image
      source={require("@/assets/images/logo.png")}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}
      resizeMode="cover"
    />
  );
}
