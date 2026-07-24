import React, { useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { ManagerColors as Colors } from "@/constants/theme";

// One member of a group — surfaced in the hover/press tooltip so a bar answers
// "who are these?" not just "how many".
export type BarMember = { name: string; meta?: string };
export type BarDatum = { label: string; value: number; members?: BarMember[] };

const TIP_W = 232;
const MAX_TIP_ROWS = 7;

// A single-series vertical bar chart: thin marks on recessive tracks, 4px rounded
// tops anchored to a hairline baseline, selective value labels. Monochrome by
// design — the title (rendered by the caller) names the one series, so no legend.
// Hovering (web) or tapping a bar reveals a tooltip with its members.
export function BarChart({
  data,
  height = 148,
  color = Colors.primary,
  showValues = true,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  showValues?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const active = pinned ?? hover;
  const padTop = showValues ? 20 : 8;
  const padBottom = 22; // room for x labels
  const plotH = Math.max(1, height - padTop - padBottom);
  const baseline = padTop + plotH;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const slot = width / n;
  const barW = Math.min(34, Math.max(8, slot * 0.46));
  const allZero = data.every((d) => d.value === 0);

  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      {width > 0 && (
        <>
          <Svg width={width} height={height}>
            {/* Faint reference gridlines (recessive) */}
            {[0.5, 1].map((f) => (
              <Line
                key={f}
                x1={0}
                y1={baseline - f * plotH}
                x2={width}
                y2={baseline - f * plotH}
                stroke={Colors.hairline}
                strokeWidth={1}
                strokeDasharray={f === 1 ? undefined : "3 5"}
              />
            ))}
            <Line x1={0} y1={baseline} x2={width} y2={baseline} stroke={Colors.warmBorder} strokeWidth={1} />
            {data.map((d, i) => {
              const cx = slot * i + slot / 2;
              const h = d.value > 0 ? Math.max(3, (d.value / max) * plotH) : 0;
              const y = baseline - h;
              const isActive = active === i;
              const dim = active != null && !isActive;
              return (
                <React.Fragment key={i}>
                  {/* Recessive track behind the bar */}
                  <Rect x={cx - barW / 2} y={padTop} width={barW} height={plotH} rx={5} fill={Colors.warmSurfaceAlt} opacity={0.6} />
                  {h > 0 && (
                    <Rect
                      x={cx - barW / 2}
                      y={y}
                      width={barW}
                      height={h}
                      rx={4}
                      fill={color}
                      opacity={dim ? 0.32 : 1}
                    />
                  )}
                  {isActive && h > 0 && (
                    <Rect x={cx - barW / 2 - 2} y={y - 2} width={barW + 4} height={h + 2} rx={6} fill="none" stroke={color} strokeWidth={1.5} opacity={0.35} />
                  )}
                  {showValues && d.value > 0 && (
                    <SvgText
                      x={cx}
                      y={y - 6}
                      fontSize={11}
                      fontWeight="800"
                      fill={dim ? Colors.textFaint : Colors.textPrimary}
                      textAnchor="middle"
                    >
                      {d.value}
                    </SvgText>
                  )}
                  {!!d.label && (
                    <SvgText
                      x={cx}
                      y={height - 6}
                      fontSize={10.5}
                      fontWeight={isActive ? "700" : "500"}
                      fill={isActive ? Colors.textBody : Colors.textFaint}
                      textAnchor="middle"
                    >
                      {truncate(d.label, Math.max(6, Math.floor(slot / 7)))}
                    </SvgText>
                  )}
                </React.Fragment>
              );
            })}
          </Svg>

          {/* Interaction layer: one hit-column per bar (hover on web, tap on touch) */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View style={{ flexDirection: "row", height }}>
              {data.map((_d, i) => (
                <Pressable
                  key={i}
                  style={{ width: slot, height }}
                  onHoverIn={() => setHover(i)}
                  onHoverOut={() => setHover((h) => (h === i ? null : h))}
                  onPress={() => setPinned((p) => (p === i ? null : i))}
                />
              ))}
            </View>
          </View>

          {active != null && data[active] && data[active].value > 0 && (
            <Tooltip
              datum={data[active]}
              color={color}
              left={clamp(slot * active + slot / 2 - TIP_W / 2, 2, Math.max(2, width - TIP_W - 2))}
              bottom={height - (baseline - Math.max(3, (data[active].value / max) * plotH)) + 12}
            />
          )}
        </>
      )}
      {width === 0 && <View style={{ height }} />}
      {allZero && <Text style={styles.empty}>No data yet</Text>}
    </View>
  );
}

function Tooltip({ datum, color, left, bottom }: { datum: BarDatum; color: string; left: number; bottom: number }) {
  const members = datum.members ?? [];
  const shown = members.slice(0, MAX_TIP_ROWS);
  const rest = members.length - shown.length;
  return (
    <View style={[styles.tip, { left, bottom, width: TIP_W }]} pointerEvents="none">
      <View style={styles.tipHead}>
        <View style={[styles.tipDot, { backgroundColor: color }]} />
        <Text style={styles.tipTitle} numberOfLines={1}>{datum.label}</Text>
        <View style={styles.tipCount}>
          <Text style={styles.tipCountText}>{datum.value}</Text>
        </View>
      </View>
      {members.length > 0 && (
        <View style={styles.tipList}>
          {shown.map((m, i) => (
            <View key={i} style={styles.tipRow}>
              <Text style={styles.tipName} numberOfLines={1}>{m.name}</Text>
              {m.meta ? <Text style={styles.tipMeta} numberOfLines={1}>{m.meta}</Text> : null}
            </View>
          ))}
          {rest > 0 && <Text style={styles.tipMore}>+{rest} more</Text>}
        </View>
      )}
    </View>
  );
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

const tipShadow =
  Platform.OS === "web"
    ? ({ boxShadow: "0 12px 28px rgba(24, 30, 16, 0.16)" } as unknown as object)
    : { shadowColor: "#181E10", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 22, elevation: 10 };

const styles = StyleSheet.create({
  empty: { position: "absolute", alignSelf: "center", top: "45%", color: Colors.textFaint, fontSize: 13 },

  tip: {
    position: "absolute",
    backgroundColor: Colors.cardSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    paddingVertical: 10,
    paddingHorizontal: 12,
    zIndex: 50,
    ...tipShadow,
  },
  tipHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  tipDot: { width: 8, height: 8, borderRadius: 3 },
  tipTitle: { flex: 1, fontSize: 13, fontWeight: "800", color: Colors.textPrimary, letterSpacing: -0.1 },
  tipCount: { minWidth: 24, paddingHorizontal: 7, height: 20, borderRadius: 999, backgroundColor: Colors.primaryTint, alignItems: "center", justifyContent: "center" },
  tipCountText: { fontSize: 12, fontWeight: "800", color: Colors.primaryDeep, fontVariant: ["tabular-nums"] },
  tipList: { marginTop: 8, gap: 5 },
  tipRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  tipName: { fontSize: 12.5, fontWeight: "600", color: Colors.textBody, flexShrink: 1 },
  tipMeta: { fontSize: 11.5, color: Colors.textFaint, fontWeight: "500", flexShrink: 0 },
  tipMore: { fontSize: 11.5, fontWeight: "700", color: Colors.textMuted, marginTop: 1 },
});
