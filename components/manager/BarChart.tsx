import React, { useState } from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { ManagerColors as Colors } from "@/constants/theme";

export type BarDatum = { label: string; value: number };

// A single-series vertical bar chart: thin marks, 3px rounded tops anchored to a
// recessive baseline, selective value labels. Monochrome by design — the title
// (rendered by the caller) names the one series, so no legend is needed.
export function BarChart({
  data,
  height = 132,
  color = Colors.primary,
  showValues = true,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  showValues?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const padTop = showValues ? 16 : 6;
  const padBottom = 20; // room for x labels
  const plotH = Math.max(1, height - padTop - padBottom);
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const slot = width / n;
  const barW = Math.min(30, Math.max(6, slot * 0.5));

  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {/* Recessive baseline */}
          <Line x1={0} y1={padTop + plotH} x2={width} y2={padTop + plotH} stroke={Colors.hairline} strokeWidth={1} />
          {data.map((d, i) => {
            const cx = slot * i + slot / 2;
            const h = d.value > 0 ? Math.max(2, (d.value / max) * plotH) : 0;
            const y = padTop + plotH - h;
            return (
              <React.Fragment key={i}>
                {h > 0 && <Rect x={cx - barW / 2} y={y} width={barW} height={h} rx={3} fill={color} />}
                {showValues && d.value > 0 && (
                  <SvgText x={cx} y={y - 5} fontSize={10} fontWeight="700" fill={Colors.textMuted} textAnchor="middle">
                    {d.value}
                  </SvgText>
                )}
                {!!d.label && (
                  <SvgText x={cx} y={height - 6} fontSize={10} fill={Colors.textFaint} textAnchor="middle">
                    {d.label}
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}
        </Svg>
      )}
      {width === 0 && <View style={{ height }} />}
      {data.every((d) => d.value === 0) && <Text style={styles.empty}>No data yet</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { position: "absolute", alignSelf: "center", top: "45%", color: Colors.textFaint, fontSize: 13 },
});
