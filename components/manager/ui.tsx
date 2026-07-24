import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
  useWindowDimensions,
} from "react-native";

import { ManagerColors as Colors } from "@/constants/theme";

// Dropdown menus render into a web portal (document.body) so they escape any
// transformed/overflow-clipping ancestor (RN-web ScrollView uses transforms) and
// float above all page content. `react-dom` only exists on web — require lazily.
type PortalApi = { createPortal: (node: React.ReactNode, container: Element) => React.ReactPortal };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reactDom: PortalApi | null = Platform.OS === "web" ? (require("react-dom") as PortalApi) : null;
const portalRoot: Element | null =
  Platform.OS === "web" && typeof document !== "undefined" ? document.body : null;
function portal(node: React.ReactNode): React.ReactNode {
  return reactDom && portalRoot ? reactDom.createPortal(node, portalRoot) : node;
}

// Removes the browser's default focus outline on web text inputs (RN-web adds a
// black outline on focus otherwise). No-op on native.
const webInputReset = (Platform.OS === "web" ? { outlineStyle: "none" } : null) as unknown as TextStyle | null;

type MdIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

// ─────────────────────────────────────────────────────────────────────────────
// Shared design system for the manager portal.
//
// Every tab consumes these primitives instead of re-deriving buttons, tables,
// inputs, and headers from raw color tokens. Tokens below are the single source
// of truth for control heights, radii, and hairlines so the whole portal stays
// visually consistent.
// ─────────────────────────────────────────────────────────────────────────────

export const Tokens = {
  radiusCard: 16,
  radiusControl: 12,
  radiusChip: 10,
  radiusPill: 999,
  controlHeight: 46,
  hairline: Colors.hairline,
} as const;

// ── Surface ──────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

// A page/section header: title + optional subtitle on the left, actions on the
// right. Replaces the ad-hoc "toolbar" / "sheetHead" rows each tab hand-rolled.
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: MdIcon;
}) {
  return (
    <View style={styles.pageHeader}>
      {icon && (
        <View style={styles.pageIcon}>
          <MaterialCommunityIcons name={icon} size={20} color={Colors.primary} />
        </View>
      )}
      <View style={styles.grow}>
        <Text style={styles.pageTitle}>{title}</Text>
        {subtitle ? <Text style={styles.pageSub}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.pageActions}>{actions}</View> : null}
    </View>
  );
}

// A back-link row for drill-in edit screens (Employees / Org editors).
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.back} onPress={onPress}>
      <MaterialCommunityIcons name="arrow-left" size={18} color={Colors.textMuted} />
      <Text style={styles.backText}>{label}</Text>
    </Pressable>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "ghost" | "danger" | "subtle" | "link";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled,
  loading,
  fullWidth,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: MdIcon;
  iconRight?: MdIcon;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}) {
  const fg = btnFg[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      style={[
        styles.btn,
        btnSize[size],
        btnVariant[variant],
        fullWidth && { alignSelf: "stretch" },
        off && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        icon && <MaterialCommunityIcons name={icon} size={size === "sm" ? 15 : 17} color={fg} />
      )}
      <Text style={[styles.btnText, size === "sm" && styles.btnTextSm, { color: fg }]}>{label}</Text>
      {iconRight && !loading && (
        <MaterialCommunityIcons name={iconRight} size={size === "sm" ? 15 : 17} color={fg} />
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  tone = "neutral",
  disabled,
}: {
  icon: MdIcon;
  onPress?: () => void;
  tone?: "neutral" | "danger" | "primary";
  disabled?: boolean;
}) {
  const map = {
    neutral: { bg: Colors.warmSurface, border: Colors.warmBorder, fg: Colors.textBody },
    danger: { bg: Colors.dangerTint, border: "transparent", fg: Colors.danger },
    primary: { bg: Colors.primaryTint, border: "transparent", fg: Colors.primary },
  }[tone];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={[styles.iconBtn, { backgroundColor: map.bg, borderColor: map.border }, disabled && styles.btnDisabled]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={map.fg} />
    </Pressable>
  );
}

// ── Badges & chips ───────────────────────────────────────────────────────────

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "pending" | "approved" | "rejected" | "in" | "out" | "warning" | "critical";
}) {
  return (
    <View style={[styles.badge, toneBg[tone]]}>
      <Text style={[styles.badgeText, toneFg[tone]]}>{label}</Text>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: MdIcon;
}) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      {icon && (
        <MaterialCommunityIcons name={icon} size={14} color={active ? "#fff" : Colors.textMuted} />
      )}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// Single-select segmented control (status / role / pay-basis toggles).
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} style={[styles.segItem, on && styles.segItemOn]} onPress={() => onChange(o.value)}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────

// Label + control + error/hint wrapper. Wrap any control (TextField, Select,
// SegmentedControl) to get consistent spacing and validation text.
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label?: string;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      {children}
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  multiline,
  keyboardType,
  secureTextEntry,
  suffix,
  autoCapitalize,
  editable = true,
  autoGrow = false,
  multilineMinHeight = 110,
  selectBracketedPlaceholder = false,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad";
  secureTextEntry?: boolean;
  suffix?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  editable?: boolean;
  autoGrow?: boolean;
  multilineMinHeight?: number;
  selectBracketedPlaceholder?: boolean;
}) {
  const [contentHeight, setContentHeight] = useState(multilineMinHeight);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  return (
    <Field label={label} error={error} hint={hint}>
      <View style={[styles.inputWrap, !editable && styles.inputDisabled]}>
        <TextInput
          value={value}
          onChangeText={(text) => {
            setSelection(undefined);
            onChangeText(text);
          }}
          placeholder={placeholder}
          placeholderTextColor={Colors.textPlaceholder}
          multiline={multiline}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          editable={editable}
          selection={selection}
          onSelectionChange={selectBracketedPlaceholder ? (event) => {
            const { start, end } = event.nativeEvent.selection;
            if (start !== end) return;
            const open = value.lastIndexOf("[", start);
            const close = value.indexOf("]", start);
            if (open >= 0 && close >= start && !value.slice(open + 1, start).includes("]")) {
              setSelection({ start: open, end: close + 1 });
            } else {
              setSelection(undefined);
            }
          } : undefined}
          scrollEnabled={!autoGrow}
          onContentSizeChange={autoGrow ? (event) => setContentHeight(event.nativeEvent.contentSize.height) : undefined}
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            autoGrow && { minHeight: multilineMinHeight, height: Math.max(multilineMinHeight, Math.ceil(contentHeight)) },
            webInputReset,
          ]}
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
    </Field>
  );
}

export function SearchInput({
  value,
  onChangeText,
  placeholder = "Search",
  width,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <View style={[styles.searchWrap, width ? { width } : { flexGrow: 1, minWidth: 180 }]}>
      <MaterialCommunityIcons name="magnify" size={18} color={Colors.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textPlaceholder}
        style={[styles.searchInput, webInputReset]}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText("")}>
          <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

// Reusable dropdown select (opens as an absolute overlay, so it never pushes
// the layout). Use for month / year / any short option list.
export function Select({
  value,
  options,
  onChange,
  width,
  placeholder = "Select",
  searchable,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  width?: number;
  placeholder?: string;
  // When true, the open menu shows a type-to-filter search box. Use for long
  // lists (e.g. an employee picker) instead of a wall of chips.
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Viewport coords of the trigger (web only) so the menu can render with
  // `position: fixed` and float above ANY page content, escaping every parent's
  // overflow/stacking. Falls back to absolute positioning on native.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<View>(null);
  const current = options.find((o) => o.value === value);
  const shown =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const openMenu = () => {
    const node = triggerRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
    if (node?.getBoundingClientRect) {
      const r = node.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    } else {
      setPos(null);
    }
    setOpen(true);
  };
  const fixedMenu = pos
    ? ({ position: "fixed", top: pos.top, left: pos.left, right: "auto", width: pos.width, zIndex: 9999 } as unknown as ViewStyle)
    : null;
  return (
    <View style={[styles.selectWrap, width ? { width } : { alignSelf: "stretch" }, open && styles.selectWrapOpen]}>
      {searchable ? (
        // Type-ahead combobox: the trigger IS the search box (no separate one).
        <View ref={triggerRef} style={[styles.selectBtn, open && styles.selectBtnOpen]}>
          <MaterialCommunityIcons name="magnify" size={16} color={Colors.textFaint} />
          <TextInput
            value={open ? query : current?.label ?? ""}
            onChangeText={(t) => {
              if (!open) openMenu();
              setQuery(t);
            }}
            onFocus={openMenu}
            placeholder={placeholder}
            placeholderTextColor={Colors.textPlaceholder}
            style={[styles.selectComboInput, webInputReset]}
          />
          <Pressable onPress={() => (open ? close() : openMenu())} hitSlop={6}>
            <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={18} color={open ? Colors.primary : Colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable ref={triggerRef} style={[styles.selectBtn, open && styles.selectBtnOpen]} onPress={() => (open ? close() : openMenu())}>
          <Text style={[styles.selectValue, !current && { color: Colors.textFaint, fontWeight: "500" }]} numberOfLines={1}>
            {current?.label ?? placeholder}
          </Text>
          <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={18} color={open ? Colors.primary : Colors.textMuted} />
        </Pressable>
      )}
      {open && portal(
        <>
          <Pressable style={fixedFill} onPress={close} />
          <View style={[styles.selectMenu, fixedMenu]}>
            <ScrollView style={styles.selectScroll} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
              {shown.length === 0 ? (
                <Text style={styles.selectEmpty}>No matches</Text>
              ) : (
                shown.map((o) => {
                  const on = o.value === value;
                  return (
                    <Pressable
                      key={o.value}
                      style={(state: { pressed: boolean; hovered?: boolean }) => [
                        styles.selectItem,
                        state.hovered && styles.selectItemHover,
                        on && styles.selectItemSelected,
                      ]}
                      onPress={() => {
                        onChange(o.value);
                        close();
                      }}
                    >
                      <Text style={[styles.selectItemText, on && styles.selectItemTextOn]} numberOfLines={1}>
                        {o.label}
                      </Text>
                      {on && <MaterialCommunityIcons name="check" size={16} color={Colors.primary} />}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

const fixedFill = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 } as unknown as ViewStyle;

// ── Tables & lists ───────────────────────────────────────────────────────────

export type Column<T> = {
  key: string;
  header: string;
  flex?: number;
  width?: number;
  align?: "left" | "right" | "center";
  // Return a string/number for a plain text cell, or a node for custom content.
  render: (row: T) => React.ReactNode;
};

// A config-driven table: header row + hairline-separated rows. Generalizes the
// mini-tables hand-rolled in Attendance/Dtr/Payroll/Leaves.
export function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  onRowPress,
  style,
}: {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T, index: number) => string;
  onRowPress?: (row: T) => void;
  style?: ViewStyle;
}) {
  const alignItems = (a?: string) => (a === "right" ? "flex-end" : a === "center" ? "center" : "flex-start");
  const textAlign = (a?: string): TextStyle => ({ textAlign: a === "right" ? "right" : a === "center" ? "center" : "left" });
  const cellFlex = (c: Column<T>) => (c.width != null ? { width: c.width } : { flex: c.flex ?? 1 });

  return (
    <View style={[styles.table, style]}>
      <View style={[styles.tr, styles.tableHead]}>
        {columns.map((c) => (
          <View key={c.key} style={[cellFlex(c), { alignItems: alignItems(c.align) }]}>
            <Text style={[styles.th, textAlign(c.align)]} numberOfLines={1}>{c.header}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, i) => {
        const body = (
          <View style={[styles.tr, i < rows.length - 1 && styles.trBorder]}>
            {columns.map((c) => {
              const content = c.render(row);
              const isText = typeof content === "string" || typeof content === "number";
              return (
                <View key={c.key} style={[cellFlex(c), { alignItems: alignItems(c.align) }]}>
                  {isText ? (
                    <Text style={[styles.td, textAlign(c.align)]} numberOfLines={1}>{content}</Text>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
          </View>
        );
        return onRowPress ? (
          <Pressable key={keyExtractor(row, i)} onPress={() => onRowPress(row)}>
            {body}
          </Pressable>
        ) : (
          <View key={keyExtractor(row, i)}>{body}</View>
        );
      })}
    </View>
  );
}

// The icon + title/subtitle + trailing row used by Approvals/Requests/Leaves/
// Devices/Audit/Documents. Renders as one row; wrap a list in a padding-0 Card.
export function ListRow({
  icon,
  iconTone = "neutral",
  title,
  subtitle,
  trailing,
  onPress,
  divider,
  selected,
}: {
  icon?: MdIcon;
  iconTone?: "neutral" | "in" | "out" | "warning" | "critical" | "primary";
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  divider?: boolean;
  selected?: boolean;
}) {
  const inner = (
    <View style={[styles.listRow, divider && styles.trBorder, selected && styles.listRowSelected]}>
      {icon && (
        <View style={[styles.listIcon, listIconTint[iconTone]]}>
          <MaterialCommunityIcons name={icon} size={19} color={listIconFg[iconTone]} />
        </View>
      )}
      <View style={styles.grow}>
        <Text style={styles.listTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.listSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {trailing}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner;
}

// Responsive master–detail layout. On wide screens the list and detail sit side
// by side; on narrow screens they stack — the detail replaces the list (with a
// back link) once something is selected. `hasSelection` drives which side shows.
export function MasterDetail({
  list,
  detail,
  hasSelection,
  onBack,
  listWidth = 330,
  placeholderIcon = "gesture-tap-button",
  placeholderText = "Select an item to view details",
}: {
  list: React.ReactNode;
  detail: React.ReactNode;
  hasSelection: boolean;
  onBack: () => void;
  listWidth?: number;
  placeholderIcon?: MdIcon;
  placeholderText?: string;
}) {
  const { width } = useWindowDimensions();
  const split = width >= 1180;

  if (split) {
    return (
      <View style={styles.mdRow}>
        <View style={[styles.mdList, { width: listWidth }]}>{list}</View>
        <View style={styles.mdDetail}>
          {hasSelection ? (
            detail
          ) : (
            <View style={styles.mdPlaceholder}>
              <MaterialCommunityIcons name={placeholderIcon} size={40} color={Colors.textPlaceholder} />
              <Text style={styles.mdPlaceholderText}>{placeholderText}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  if (hasSelection) {
    return (
      <View>
        <BackLink label="Back to list" onPress={onBack} />
        {detail}
      </View>
    );
  }
  return <View>{list}</View>;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export type StatTone = "in" | "out" | "neutral" | "pending" | "critical" | "primary";

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  onPress,
  selected = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: MdIcon;
  tone?: StatTone;
  onPress?: () => void;
  selected?: boolean;
}) {
  const content = (
    <>
      <View style={[styles.tileIcon, tileTint[tone]]}>
        <MaterialCommunityIcons name={icon} size={18} color={tileFg[tone]} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub ? <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: selected }}
        accessibilityLabel={`${label}: ${value}. Show details`}
        style={({ pressed }) => [styles.tile, styles.tileInteractive, selected && styles.tileSelected, pressed && styles.tilePressed]}
      >
        {content}
        <MaterialCommunityIcons
          name={selected ? "chevron-up" : "chevron-down"}
          size={17}
          color={selected ? Colors.primary : Colors.textFaint}
          style={styles.tileChevron}
        />
      </Pressable>
    );
  }

  return <View style={styles.tile}>{content}</View>;
}

// A label ─ value line for key/value summaries (payslips, final-pay breakdowns).
export function KeyValueLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.kvLine}>
      <Text style={[styles.kvLabel, strong && styles.kvStrong]}>{label}</Text>
      <Text style={[styles.kvValue, strong && styles.kvStrong]}>{value}</Text>
    </View>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export function InlineMessage({ text, tone = "info" }: { text: string; tone?: "info" | "success" | "error" }) {
  return (
    <View style={[styles.inlineMsg, inlineTint[tone]]}>
      <MaterialCommunityIcons
        name={tone === "error" ? "alert-circle-outline" : tone === "success" ? "check-circle-outline" : "information-outline"}
        size={16}
        color={inlineFg[tone]}
      />
      <Text style={[styles.inlineText, { color: inlineFg[tone] }]}>{text}</Text>
    </View>
  );
}

export function EmptyState({ icon, text }: { icon: MdIcon; text: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon} size={42} color={Colors.textPlaceholder} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// ── Tone maps ────────────────────────────────────────────────────────────────

const toneBg: Record<string, ViewStyle> = {
  neutral: { backgroundColor: Colors.warmSurfaceAlt },
  pending: { backgroundColor: Colors.warningSurface },
  approved: { backgroundColor: Colors.successTint },
  rejected: { backgroundColor: Colors.dangerTint },
  in: { backgroundColor: Colors.successTint },
  out: { backgroundColor: Colors.warmSurfaceAlt },
  warning: { backgroundColor: Colors.warningSurface },
  critical: { backgroundColor: Colors.dangerTint },
};
const toneFg: Record<string, { color: string }> = {
  neutral: { color: Colors.primaryDark },
  pending: { color: Colors.warningDeep },
  approved: { color: Colors.success },
  rejected: { color: Colors.danger },
  in: { color: Colors.success },
  out: { color: Colors.primaryDark },
  warning: { color: Colors.warningDeep },
  critical: { color: Colors.danger },
};

const btnVariant: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: Colors.primary },
  ghost: { backgroundColor: Colors.cardSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  danger: { backgroundColor: Colors.danger },
  subtle: { backgroundColor: Colors.warmSurfaceAlt },
  link: { backgroundColor: "transparent" },
};
const btnFg: Record<ButtonVariant, string> = {
  primary: "#FFFFFF",
  ghost: Colors.primaryDeep,
  danger: "#FFFFFF",
  subtle: Colors.primaryDeep,
  link: Colors.textMuted,
};
const btnSize: Record<ButtonSize, ViewStyle> = {
  sm: { height: 36, paddingHorizontal: 12, borderRadius: 10 },
  md: { height: 44, paddingHorizontal: 16, borderRadius: 12 },
  lg: { height: 50, paddingHorizontal: 20, borderRadius: 13 },
};

const tileTint: Record<StatTone, ViewStyle> = {
  in: { backgroundColor: Colors.successTint },
  out: { backgroundColor: Colors.warmSurfaceAlt },
  neutral: { backgroundColor: Colors.primaryTint },
  primary: { backgroundColor: Colors.primaryTint },
  pending: { backgroundColor: Colors.warningSurface },
  critical: { backgroundColor: Colors.dangerTint },
};
const tileFg: Record<StatTone, string> = {
  in: Colors.success,
  out: Colors.primaryDark,
  neutral: Colors.primary,
  primary: Colors.primary,
  pending: Colors.warningDeep,
  critical: Colors.danger,
};

const listIconTint: Record<string, ViewStyle> = {
  neutral: { backgroundColor: Colors.warmSurfaceAlt },
  primary: { backgroundColor: Colors.primaryTint },
  in: { backgroundColor: Colors.successTint },
  out: { backgroundColor: Colors.warmSurfaceAlt },
  warning: { backgroundColor: Colors.warningSurface },
  critical: { backgroundColor: Colors.dangerTint },
};
const listIconFg: Record<string, string> = {
  neutral: Colors.textMuted,
  primary: Colors.primary,
  in: Colors.success,
  out: Colors.textMuted,
  warning: Colors.warningDeep,
  critical: Colors.danger,
};

const inlineTint: Record<string, ViewStyle> = {
  info: { backgroundColor: Colors.primaryTint },
  success: { backgroundColor: Colors.successTint },
  error: { backgroundColor: Colors.dangerTint },
};
const inlineFg: Record<string, string> = {
  info: Colors.primaryDeep,
  success: Colors.success,
  error: Colors.danger,
};

// A soft, layered elevation. On web we use a two-stop box-shadow (a tight contact
// shadow plus a wider ambient one) which reads far more refined than RN's single
// blur; native keeps the equivalent single-shadow approximation.
const cardShadow = (
  Platform.OS === "web"
    ? { boxShadow: "0 1px 2px rgba(31, 41, 55, 0.04), 0 6px 20px rgba(31, 41, 55, 0.055)" }
    : { shadowColor: "#1F2937", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 1 }
) as unknown as ViewStyle;

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },

  card: {
    backgroundColor: Colors.cardSurface,
    borderRadius: Tokens.radiusCard,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    ...cardShadow,
  },
  section: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
    color: Colors.textPrimary,
    marginTop: 6,
    marginBottom: 12,
  },

  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  pageIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: { fontSize: 18, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.3 },
  pageSub: { fontSize: 13, fontWeight: "500", color: Colors.textFaint, marginTop: 2 },
  pageActions: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },

  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14, alignSelf: "flex-start" },
  backText: { fontSize: 14, fontWeight: "700", color: Colors.textMuted },

  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnText: { fontSize: 14, fontWeight: "700", letterSpacing: 0.1 },
  btnTextSm: { fontSize: 13 },
  btnDisabled: { opacity: 0.45 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  badge: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "transparent",
  },
  badgeText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: Tokens.radiusChip,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.warmSurface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: Colors.textBody, flexShrink: 1 },
  chipTextActive: { color: "#fff" },

  segment: {
    flexDirection: "row",
    backgroundColor: Colors.warmSurfaceAlt,
    borderRadius: Tokens.radiusControl,
    padding: 3,
    alignSelf: "flex-start",
  },
  segItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9 },
  segItemOn: { backgroundColor: Colors.cardSurface, ...cardShadow },
  segText: { fontSize: 13, fontWeight: "700", color: Colors.textMuted },
  segTextOn: { color: Colors.primaryDeep },

  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 6, letterSpacing: 0.1 },
  fieldError: { fontSize: 12, fontWeight: "600", color: Colors.danger, marginTop: 5 },
  fieldHint: { fontSize: 12, color: Colors.textFaint, marginTop: 5 },

  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    borderRadius: Tokens.radiusControl,
    paddingHorizontal: 12,
  },
  inputDisabled: { opacity: 0.6 },
  input: { flex: 1, height: Tokens.controlHeight, fontSize: 15, color: Colors.textPrimary, paddingVertical: 0 },
  inputMultiline: { height: undefined, minHeight: 110, paddingTop: 12, textAlignVertical: "top" },
  inputSuffix: { fontSize: 14, fontWeight: "600", color: Colors.textFaint, marginLeft: 8 },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: Tokens.controlHeight,
    paddingHorizontal: 14,
    borderRadius: Tokens.radiusControl,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.warmSurface,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.textPrimary, paddingVertical: 0 },

  selectWrap: { position: "relative" },
  selectWrapOpen: { zIndex: 50 },
  selectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, height: Tokens.controlHeight, paddingHorizontal: 14, borderRadius: Tokens.radiusControl, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.warmSurface },
  selectBtnOpen: { borderColor: Colors.primary, backgroundColor: Colors.cardSurface },
  selectValue: { fontSize: 15, color: Colors.textPrimary, fontWeight: "600", flex: 1 },
  selectMenu: { position: "absolute", top: 50, left: 0, right: 0, backgroundColor: Colors.cardSurface, borderRadius: Tokens.radiusControl, borderWidth: 1, borderColor: Colors.hairline, paddingVertical: 4, zIndex: 50, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 8 },
  selectScroll: { maxHeight: 240 },
  selectItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginHorizontal: 4 },
  selectItemHover: { backgroundColor: Colors.warmSurface },
  selectItemSelected: { backgroundColor: Colors.primaryTint },
  selectItemText: { fontSize: 14, color: Colors.textBody, fontWeight: "600", flex: 1 },
  selectItemTextOn: { color: Colors.primary, fontWeight: "800" },
  selectSearch: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 40, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  selectSearchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary, paddingVertical: 0 },
  selectComboInput: { flex: 1, fontSize: 14, color: Colors.textPrimary, fontWeight: "600", paddingVertical: 0 },
  selectEmpty: { fontSize: 13, color: Colors.textFaint, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 12 },

  table: {
    backgroundColor: Colors.cardSurface,
    borderRadius: Tokens.radiusCard,
    borderWidth: 1,
    borderColor: Colors.hairline,
    overflow: "hidden",
    ...cardShadow,
  },
  tr: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  tableHead: { backgroundColor: Colors.warmSurface },
  trBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  th: { fontSize: 11.5, fontWeight: "800", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { fontSize: 14, color: Colors.textPrimary },

  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  listRowSelected: { backgroundColor: Colors.primaryTint },
  listIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  listTitle: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  listSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  mdRow: { flexDirection: "row", alignItems: "flex-start", gap: 18 },
  mdList: { flexShrink: 0 },
  mdDetail: { flex: 1, minWidth: 0 },
  mdPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 90,
    backgroundColor: Colors.cardSurface,
    borderRadius: Tokens.radiusCard,
    borderWidth: 1,
    borderColor: Colors.hairline,
    borderStyle: "dashed",
  },
  mdPlaceholderText: { fontSize: 14, color: Colors.textFaint, fontWeight: "600" },

  tile: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    backgroundColor: Colors.cardSurface,
    borderRadius: Tokens.radiusCard,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 16,
    ...cardShadow,
  },
  tileInteractive: { position: "relative" },
  tileSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryTint },
  tilePressed: { opacity: 0.82 },
  tileChevron: { position: "absolute", top: 16, right: 14 },
  tileIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  tileValue: { fontSize: 27, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  tileLabel: { fontSize: 12.5, color: Colors.textPrimary, marginTop: 2, fontWeight: "700" },
  tileSub: { fontSize: 11.5, color: Colors.textFaint, marginTop: 2, fontWeight: "600" },

  kvLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 7 },
  kvLabel: { fontSize: 13.5, color: Colors.textMuted, fontWeight: "600", flexShrink: 1 },
  kvValue: { fontSize: 14, color: Colors.textPrimary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  kvStrong: { color: Colors.textPrimary, fontWeight: "800" },

  inlineMsg: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: Tokens.radiusControl, marginBottom: 12 },
  inlineText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },

  empty: { alignItems: "center", paddingVertical: 50, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textFaint, fontWeight: "500" },
});
