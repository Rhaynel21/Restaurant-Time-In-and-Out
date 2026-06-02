import { useWindowDimensions } from "react-native";

/**
 * Maximum width we want our main column to occupy. Anything wider than this
 * (tablets, landscape phones, foldables, web) keeps the column at this width
 * and pads the rest of the viewport with cream canvas.
 */
export const MAX_CONTENT_WIDTH = 520;

/** Tablet-ish breakpoint. */
export const TABLET_BREAKPOINT = 600;

/**
 * Returns the horizontal padding to apply to a screen's main content so it
 * stays comfortably centered. On phones it returns `min` (the screen's design
 * value); on wider viewports it grows so the content keeps `MAX_CONTENT_WIDTH`.
 */
export function useResponsiveInset(min: number) {
  const { width } = useWindowDimensions();
  return Math.max(min, (width - MAX_CONTENT_WIDTH) / 2);
}

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isWide: width >= TABLET_BREAKPOINT,
    contentMaxWidth: MAX_CONTENT_WIDTH,
  };
}
