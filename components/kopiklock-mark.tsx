import { Image } from "react-native";

type Props = {
  size?: number;
  discColor?: string;
};

export function KopiklockMark({ size = 96 }: Props) {
  return (
    <Image
      source={require("@/assets/images/logo.png")}
      style={{ width: size, height: size, resizeMode: "contain" }}
    />
  );
}
