export const Colors = {
  // Brand — Qui · Pan-Asian Brasserie (monochrome ink & ivory, Art-Deco luxe)
  primary: "#0A0A0A",        // Ink black — main brand
  primaryDark: "#000000",    // Pressed / pure black
  primaryDeep: "#1A1A1A",    // Soft black
  primaryTint: "rgba(10, 10, 10, 0.05)",  // Subtle ink wash
  primaryTintStrong: "rgba(10, 10, 10, 0.12)",
  accent: "#9A7B3F",         // Muted brass / champagne — sparing warm highlight

  // Surfaces (warm ivory neutrals)
  background: "#F7F5F0",     // App canvas (ivory)
  cardSurface: "#FFFFFF",
  warmSurface: "#F2EFE9",    // Soft cream surface
  warmSurfaceAlt: "#EAE6DD", // Slightly deeper taupe wash
  warmBorder: "#E3DED4",     // Hairline border

  // Dark surface (bottom bar, avatars)
  darkSurface: "#0A0A0A",
  darkSurfaceAlt: "#141414",

  // Text scale (ink charcoal)
  textPrimary: "#141414",
  textBody: "#2A2A2A",
  textMuted: "#6B6B6B",
  textSubtle: "#8A8A8A",
  textFaint: "#A8A8A8",
  textPlaceholder: "#C4C4C4",
  textOnDark: "#F7F5F0",

  // Status (muted, sophisticated — used sparingly against the monochrome chrome)
  success: "#2F6B4F",
  successTint: "rgba(47, 107, 79, 0.10)",
  warning: "#9A7B3F",
  warningDeep: "#6E5526",
  warningSurface: "#F7F2E8",
  warningBorder: "#E0D4B8",
  danger: "#B23A3A",
  dangerTint: "rgba(178, 58, 58, 0.08)",
  info: "#3A5A7A",

  // Hairline / shadow tokens
  hairline: "rgba(10, 10, 10, 0.05)",
  shadowWarm: "#0A0A0A",
};

// ── Admin / Manager web portal — Brand Greens ───────────────────────────────
// Scoped to the manager portal only (the employee mobile app keeps the
// monochrome ink theme). Same token names as `Colors`, so manager components
// opt in with: `import { ManagerColors as Colors } from "@/constants/theme"`.
export const ManagerColors = {
  // Brand greens
  primary: "#5E6F3F",        // Primary green — buttons, active nav, icons
  primaryDark: "#4F5D3A",    // Deep olive — pressed / hover / gradient end
  primaryDeep: "#3F4E2A",    // Deep text green — strong accents
  primaryTint: "rgba(94, 111, 63, 0.10)",
  primaryTintStrong: "rgba(94, 111, 63, 0.18)",
  accent: "#8FA17A",         // Accent sage — arrows, subtle highlights

  // Surfaces
  background: "#F4F1EC",     // Page background (cream)
  cardSurface: "#FFFFFF",
  warmSurface: "#F9FAFB",    // Muted panel / hover
  warmSurfaceAlt: "#EEF1EA", // Slightly deeper sage wash
  warmBorder: "#E5E7EB",     // Inputs / borders

  // Dark (green) surface — sidebar solid fallback, avatars, mobile bar
  darkSurface: "#4F5D3A",
  darkSurfaceAlt: "#3F4E2A",

  // Text
  textPrimary: "#3F4E2A",    // Deep text green — titles & strong text
  textBody: "#374151",       // Body gray
  textMuted: "#6B7280",      // Muted / secondary
  textSubtle: "#6B7280",
  textFaint: "#9CA3AF",
  textPlaceholder: "#C4CAD3",
  textOnDark: "#F4F1EC",     // Cream on green

  // Status
  success: "#16A34A",
  successTint: "rgba(22, 163, 74, 0.10)",
  warning: "#B45309",
  warningDeep: "#92400E",
  warningSurface: "#FEF3E2",
  warningBorder: "#F5D9A8",
  danger: "#991B1B",
  dangerTint: "rgba(153, 27, 27, 0.08)",
  info: "#2563EB",

  // Hairline / shadow
  hairline: "#E5E7EB",
  shadowWarm: "#2F3824",
};

export const Fonts = {
  rounded: undefined as string | undefined,
  mono: undefined as string | undefined,
};
