import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Card, EmptyState, SectionTitle, Select } from "@/components/manager/ui";
import { ManagerColors as Colors } from "@/constants/theme";
import { EmployeeSummary, subscribeEmployees } from "@/lib/employees";
import { notify } from "@/lib/notifications";
import { inScope } from "@/lib/org";
import { downloadSchedules, parseScheduleWorkbook } from "@/lib/schedule-import";
import {
  RestRotation,
  Schedule,
  Shift,
  ShiftBlock,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  emptySchedule,
  formatShift,
  fromYMDsafe,
  getSchedule,
  makeShift,
  publishSchedule,
  saveSchedule,
  shiftBlocks,
  unlockPublishedSchedule,
} from "@/lib/schedules";

// Today's date as YYYY-MM-DD (used to seed a new rotation's anchor).
function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtOverrideDate(ymd: string) {
  const d = fromYMDsafe(ymd);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function SchedulesTab({ managerName, allowed }: { managerName: string; allowed: Set<string> | null }) {
  const [allEmployees, setAllEmployees] = useState<EmployeeSummary[]>([]);
  const employees = allEmployees.filter((e) => inScope(e.branchId, allowed));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sched, setSched] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // New-override inputs
  const [ovDate, setOvDate] = useState("");
  const [ovStart, setOvStart] = useState("09:00");
  const [ovEnd, setOvEnd] = useState("18:00");
  const [ovOff, setOvOff] = useState(false);

  // Bulk schedule upload / download (web only)
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  useEffect(() => subscribeEmployees(setAllEmployees, () => setAllEmployees([])), []);

  // Match an imported row to a roster employee — by ID first, then by exact name.
  const matchEmployee = (row: { employeeId: string | null; employeeName: string | null }) => {
    const id = row.employeeId?.trim().toUpperCase();
    if (id) {
      const byId = employees.find((e) => e.employeeId.trim().toUpperCase() === id);
      if (byId) return byId;
    }
    const name = row.employeeName?.trim().toLowerCase();
    if (name) {
      const byName = employees.find((e) => e.fullName.trim().toLowerCase() === name);
      if (byName) return byName;
    }
    return null;
  };

  const exportSchedules = async () => {
    setExporting(true);
    setImportMsg("");
    try {
      // Pull each employee's saved weekly grid so the file mirrors real schedules.
      const withWeekly = await Promise.all(
        employees.map(async (e) => {
          const s = await getSchedule(e.employeeId);
          return {
            employeeId: e.employeeId,
            fullName: e.fullName,
            weekly: s.weekly,
            breakStart: s.breakStart,
            breakEnd: s.breakEnd,
          };
        }),
      );
      await downloadSchedules(withWeekly, "schedules.xlsx");
      setImportMsg(`✓ Downloaded ${withWeekly.length} schedule${withWeekly.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setImportMsg("Download failed: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setExporting(false);
    }
  };

  const importExcel = () => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportMsg("");
      try {
        const buf = await file.arrayBuffer();
        const rows = await parseScheduleWorkbook(buf);
        if (rows.length === 0) {
          setImportMsg("No rows found. Check the sheet has a header row and employee rows.");
          return;
        }
        let saved = 0;
        const skipped: string[] = [];
        for (const row of rows) {
          const emp = matchEmployee(row);
          if (!emp) {
            skipped.push(row.employeeId || row.employeeName || "?");
            continue;
          }
          // Preserve existing overrides + meal break; only replace the weekly grid.
          const existing = await getSchedule(emp.employeeId);
          await saveSchedule(
            {
              employeeId: emp.employeeId,
              employeeName: emp.fullName,
              branchId: emp.branchId,
              branchName: emp.branchName,
              weekly: row.weekly,
              overrides: existing.overrides,
              restRotation: existing.restRotation,
              breakStart: row.breakStart ?? existing.breakStart,
              breakEnd: row.breakEnd ?? existing.breakEnd,
            },
            managerName,
          );
          saved++;
        }
        const skipNote = skipped.length
          ? ` · skipped ${skipped.length} unknown (${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""})`
          : "";
        setImportMsg(`✓ Imported ${saved} schedule${saved === 1 ? "" : "s"}${skipNote}`);
        // Refresh the open editor if its employee was just updated.
        if (selectedId) {
          const refreshed = await getSchedule(selectedId);
          setSched((prev) => (prev ? { ...refreshed, employeeName: prev.employeeName, branchId: prev.branchId, branchName: prev.branchName } : prev));
        }
      } catch (e) {
        setImportMsg("Import failed: " + (e instanceof Error ? e.message : "unknown error"));
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const pickEmployee = async (emp: EmployeeSummary) => {
    setSelectedId(emp.employeeId);
    setMessage("");
    setLoading(true);
    try {
      const s = await getSchedule(emp.employeeId);
      // Stamp identity from the roster so a brand-new schedule saves with name/branch.
      setSched({ ...s, employeeName: emp.fullName, branchId: emp.branchId, branchName: emp.branchName });
    } catch {
      setSched(emptySchedule(emp.employeeId, emp.fullName));
    } finally {
      setLoading(false);
    }
  };

  // Replace one weekday's whole shift (blocks + rest flag).
  const setDayShift = (day: number, shift: Shift) => {
    setSched((prev) => {
      if (!prev) return prev;
      const weekly = prev.weekly.map((s, i) => (i === day ? shift : s));
      return { ...prev, weekly };
    });
  };

  const toggleDayRest = (day: number) =>
    setSched((prev) => {
      if (!prev) return prev;
      const cur = prev.weekly[day];
      const next = cur.off ? makeShift(false, [{ start: "09:00", end: "18:00" }]) : makeShift(true, []);
      const weekly = prev.weekly.map((s, i) => (i === day ? next : s));
      return { ...prev, weekly };
    });

  // "Drag to copy": stamp one day's shift onto another day.
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const copyDayTo = (toDay: number) => {
    if (copyFrom === null || copyFrom === toDay) return;
    setSched((prev) => {
      if (!prev) return prev;
      const src = prev.weekly[copyFrom];
      const weekly = prev.weekly.map((s, i) => (i === toDay ? { ...src } : s));
      return { ...prev, weekly };
    });
  };

  // ── Rest-day rotation ──
  const rotation = sched?.restRotation ?? null;
  const setRotation = (next: RestRotation | null) => setSched((prev) => (prev ? { ...prev, restRotation: next } : prev));
  const toggleRotation = () => {
    if (rotation?.enabled) {
      setRotation(null);
    } else {
      setRotation({
        enabled: true,
        anchorDate: todayYMD(),
        workDays: 6,
        restDays: 1,
        shift: makeShift(false, [{ start: "09:00", end: "18:00" }]),
      });
    }
  };
  const patchRotation = (patch: Partial<RestRotation>) => {
    if (!rotation) return;
    setRotation({ ...rotation, ...patch });
  };

  const setBreak = (patch: Partial<Pick<Schedule, "breakStart" | "breakEnd">>) =>
    setSched((prev) => (prev ? { ...prev, ...patch } : prev));

  const toggleNoBreak = () =>
    setSched((prev) => {
      if (!prev) return prev;
      const hasBreak = !!prev.breakStart && !!prev.breakEnd;
      return hasBreak
        ? { ...prev, breakStart: null, breakEnd: null }
        : { ...prev, breakStart: "12:00", breakEnd: "13:00" };
    });

  const addOverride = () => {
    if (!sched) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ovDate)) {
      setMessage("Enter the override date as YYYY-MM-DD.");
      return;
    }
    setSched({
      ...sched,
      overrides: { ...sched.overrides, [ovDate]: { off: ovOff, start: ovStart, end: ovEnd } },
    });
    setOvDate("");
    setOvOff(false);
    setMessage("");
  };

  const removeOverride = (ymd: string) => {
    if (!sched) return;
    const next = { ...sched.overrides };
    delete next[ymd];
    setSched({ ...sched, overrides: next });
  };

  const save = async () => {
    if (!sched) return;
    try {
      setSaving(true);
      setMessage("");
      await publishSchedule(sched, managerName);
      setMessage("✓ Schedule saved.");
    } catch (e) {
      setMessage("Failed to save: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  // Step 2 — publish: save the schedule and notify the employee it's live. This is
  // the "publishing notifies staff" step; the staff member sees it in their bell.
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    if (!sched) return;
    try {
      setPublishing(true);
      setMessage("");
      await saveSchedule(sched, managerName);
      notify(
        sched.employeeId,
        "Schedule published",
        `Your work schedule has been published by ${managerName}. Check your shifts and rest days in the app.`,
        "info",
      );
      setSched({ ...sched, publishedLocked: true, publishedAt: new Date(), publishedBy: managerName });
      setMessage("✓ Schedule published, locked, and employee notified.");
    } catch (e) {
      setMessage("Failed to publish: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setPublishing(false);
    }
  };

  const unlockDraft = async () => {
    if (!sched) return;
    try {
      await unlockPublishedSchedule(sched.employeeId, managerName);
      setSched({ ...sched, publishedLocked: false });
      setMessage("Schedule unlocked. Changes remain a draft until republished.");
    } catch (e) {
      setMessage("Unlock failed: " + (e instanceof Error ? e.message : "unknown error"));
    }
  };

  const overrideKeys = useMemo(
    () => (sched ? Object.keys(sched.overrides).sort() : []),
    [sched],
  );

  // Step A — weekly scheduled hours. PH normal hours are 48/week (6 × 8h); a
  // weekly default that schedules more than that is flagged so it's a deliberate
  // OT arrangement, not an accident.
  const weeklyHours = useMemo(() => {
    if (!sched) return 0;
    let mins = 0;
    for (const shift of sched.weekly) {
      if (shift.off) continue;
      for (const b of shiftBlocks(shift)) {
        const [sh, sm] = b.start.split(":").map(Number);
        const [eh, em] = b.end.split(":").map(Number);
        if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) continue;
        let span = eh * 60 + em - (sh * 60 + sm);
        if (span < 0) span += 24 * 60; // overnight block
        mins += span;
      }
    }
    return mins / 60;
  }, [sched]);
  const overWeeklyCap = weeklyHours > 48;

  return (
    <View>
      <SectionTitle>Employee</SectionTitle>
      <Card>
        {employees.length === 0 ? (
          <Text style={styles.muted}>Loading employees…</Text>
        ) : (
          <>
            <View style={styles.pickerRow}>
              <View style={styles.pickerCol}>
                <Text style={styles.pickerLabel}>Employee</Text>
                <Select
                  value={selectedId}
                  searchable
                  placeholder="Search & select employee…"
                  options={employees.map((e) => ({ value: e.employeeId, label: `${e.fullName} · ${e.employeeId}` }))}
                  onChange={(id) => {
                    const emp = employees.find((e) => e.employeeId === id);
                    if (emp) pickEmployee(emp);
                  }}
                />
              </View>
              {Platform.OS === "web" && (
                <View style={styles.pickerActions}>
                  <Button label={exporting ? "Preparing…" : "Download Schedule"} variant="ghost" icon="tray-arrow-down" loading={exporting} onPress={exportSchedules} />
                  <Button label={importing ? "Uploading…" : "Upload Schedule"} icon="tray-arrow-up" loading={importing} onPress={importExcel} />
                </View>
              )}
            </View>
            {Platform.OS === "web" && (
              <Text style={styles.importHint}>
                Upload a schedule file (.xlsx/.csv) with a header row: <Text style={styles.mono}>Employee ID · Name · Sun…Sat</Text>. Each
                day cell is a time range like <Text style={styles.mono}>09:00-18:00</Text> or <Text style={styles.mono}>OFF</Text> for a
                rest day. This sets each employee&apos;s weekly default; existing date overrides are kept.
              </Text>
            )}
            {importMsg ? <Text style={styles.message}>{importMsg}</Text> : null}
          </>
        )}
      </Card>

      {loading && <Text style={styles.muted}>Loading schedule…</Text>}

      {sched && !loading && (
        <>
          <SectionTitle>Weekly Default</SectionTitle>
          <View style={[styles.hoursChip, overWeeklyCap && styles.hoursChipWarn]}>
            <MaterialCommunityIcons
              name={overWeeklyCap ? "alert" : "clock-outline"}
              size={14}
              color={overWeeklyCap ? Colors.warningDeep : Colors.textMuted}
            />
            <Text style={[styles.hoursChipText, overWeeklyCap && styles.hoursChipTextWarn]}>
              {weeklyHours % 1 === 0 ? weeklyHours : weeklyHours.toFixed(1)} h scheduled / week
              {overWeeklyCap ? " · over 48 h — OT arrangement" : ""}
            </Text>
          </View>
          {rotation?.enabled && (
            <Text style={styles.rotationBanner}>
              Rest days are driven by the rotation below while it&apos;s on — the per-day Rest toggles here are ignored.
            </Text>
          )}
          <Card>
            {sched.weekly.map((shift, day) => {
              const isCopySource = copyFrom === day;
              return (
                <View key={day} style={[styles.dayBlock, day < 6 && styles.rowBorder, shift.off && styles.dayBlockRest]}>
                  <View style={styles.dayRow}>
                    <View style={styles.dayLabelCol}>
                      <Text style={[styles.weekDay, shift.off && styles.weekDayOff]}>{WEEKDAY_SHORT[day]}</Text>
                      <Text style={styles.weekDayFull}>{WEEKDAY_LABELS[day]}</Text>
                    </View>

                    <View style={styles.dayContent}>
                      {shift.off ? (
                        <Text style={styles.dayRestText}>No shift — rest day</Text>
                      ) : (
                        <BlockEditor shift={shift} onChange={(s) => setDayShift(day, s)} />
                      )}
                      {copyFrom !== null && copyFrom !== day && (
                        <Pressable style={styles.pasteBtn} onPress={() => copyDayTo(day)}>
                          <MaterialCommunityIcons name="content-paste" size={13} color={Colors.primary} />
                          <Text style={styles.pasteText}>
                            Paste {WEEKDAY_SHORT[copyFrom]} → {WEEKDAY_SHORT[day]}
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    <View style={styles.dayActions}>
                      <Pressable style={[styles.restPill, shift.off && styles.restPillOn]} onPress={() => toggleDayRest(day)}>
                        <MaterialCommunityIcons name={shift.off ? "sleep" : "sleep-off"} size={13} color={shift.off ? "#fff" : Colors.textMuted} />
                        <Text style={[styles.restPillText, shift.off && styles.restPillTextOn]}>Rest day</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.copyBtn, isCopySource && styles.copyBtnActive]}
                        onPress={() => setCopyFrom(isCopySource ? null : day)}
                      >
                        <MaterialCommunityIcons name="content-copy" size={13} color={isCopySource ? "#fff" : Colors.textMuted} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
            {copyFrom !== null && (
              <Pressable style={styles.copyDoneBtn} onPress={() => setCopyFrom(null)}>
                <Text style={styles.copyDoneText}>Done copying {WEEKDAY_SHORT[copyFrom]}</Text>
              </Pressable>
            )}
          </Card>

          <SectionTitle>Rest Day Rotation</SectionTitle>
          <Card>
            <View style={styles.rotHeaderRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.rotTitle}>Rotating rest days</Text>
                <Text style={styles.rotHint}>
                  Work N days, rest M days — the rest day rotates through the week each cycle. Overrides the weekly rest
                  pattern above.
                </Text>
              </View>
              <Pressable style={[styles.switch, rotation?.enabled && styles.switchOn]} onPress={toggleRotation}>
                <View style={[styles.knob, rotation?.enabled && styles.knobOn]} />
              </Pressable>
            </View>

            {rotation?.enabled && (
              <View style={styles.rotBody}>
                <View>
                  <Text style={styles.rotSubLabel}>Quick presets</Text>
                  <View style={styles.rotPresets}>
                    {[
                      { w: 6, r: 1, label: "6-day week" },
                      { w: 5, r: 2, label: "5-day week" },
                      { w: 4, r: 2, label: "4-on / 2-off" },
                    ].map((p) => {
                      const on = rotation.workDays === p.w && rotation.restDays === p.r;
                      return (
                        <Pressable key={p.label} style={[styles.presetBtn, on && styles.presetBtnOn]} onPress={() => patchRotation({ workDays: p.w, restDays: p.r })}>
                          <Text style={[styles.presetText, on && styles.presetTextOn]}>{p.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.rotFields}>
                  <View style={styles.rotField}>
                    <Text style={styles.rotFieldLabel}>Cycle start</Text>
                    <TextInput
                      style={[styles.timeInput, styles.rotDateInput, webNoOutline]}
                      value={rotation.anchorDate}
                      onChangeText={(t) => patchRotation({ anchorDate: t })}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textPlaceholder}
                    />
                  </View>
                  <View style={styles.rotField}>
                    <Text style={styles.rotFieldLabel}>Work days</Text>
                    <Stepper value={rotation.workDays} min={1} onChange={(v) => patchRotation({ workDays: v })} />
                  </View>
                  <View style={styles.rotField}>
                    <Text style={styles.rotFieldLabel}>Rest days</Text>
                    <Stepper value={rotation.restDays} min={1} onChange={(v) => patchRotation({ restDays: v })} />
                  </View>
                </View>

                <View>
                  <Text style={styles.rotSubLabel}>Working-day hours</Text>
                  <BlockEditor shift={rotation.shift} onChange={(s) => patchRotation({ shift: s })} />
                </View>

                <Text style={styles.rotHint}>
                  Cycle: {rotation.workDays + rotation.restDays} days — {rotation.workDays} on, {rotation.restDays} off.
                </Text>
              </View>
            )}
          </Card>

          <SectionTitle>Meal Break</SectionTitle>
          <Card>
            {(() => {
              const noBreak = !sched.breakStart || !sched.breakEnd;
              return (
                <>
                  <View style={styles.breakRow}>
                    <MaterialCommunityIcons name="silverware-fork-knife" size={18} color={Colors.textMuted} />
                    <TextInput
                      style={[styles.timeInput, noBreak && styles.disabled, webNoOutline]}
                      value={sched.breakStart ?? ""}
                      editable={!noBreak}
                      onChangeText={(t) => setBreak({ breakStart: t })}
                      placeholder="12:00"
                      placeholderTextColor={Colors.textPlaceholder}
                    />
                    <Text style={styles.dash}>–</Text>
                    <TextInput
                      style={[styles.timeInput, noBreak && styles.disabled, webNoOutline]}
                      value={sched.breakEnd ?? ""}
                      editable={!noBreak}
                      onChangeText={(t) => setBreak({ breakEnd: t })}
                      placeholder="13:00"
                      placeholderTextColor={Colors.textPlaceholder}
                    />
                    <View style={styles.breakSpacer} />
                    <Pressable style={styles.restToggle} onPress={toggleNoBreak}>
                      <View style={[styles.checkbox, noBreak && styles.checkboxOn]}>
                        {noBreak && <MaterialCommunityIcons name="check" size={12} color="#fff" />}
                      </View>
                      <Text style={styles.restLabel}>No break</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.breakHint}>
                    Unpaid meal break deducted from worked hours. The biometric terminal uses this window to tag break-out /
                    break-in punches.
                  </Text>
                </>
              );
            })()}
          </Card>

          <SectionTitle>Date Overrides</SectionTitle>
          <Card>
            {overrideKeys.length === 0 ? (
              <Text style={styles.muted}>No date overrides.</Text>
            ) : (
              overrideKeys.map((ymd) => (
                <View key={ymd} style={styles.ovRow}>
                  <Text style={styles.ovDate}>{fmtOverrideDate(ymd)}</Text>
                  <Text style={styles.ovShift}>{formatShift(sched.overrides[ymd])}</Text>
                  <Pressable style={styles.ovDel} onPress={() => removeOverride(ymd)}>
                    <MaterialCommunityIcons name="close" size={16} color={Colors.danger} />
                  </Pressable>
                </View>
              ))
            )}
            <View style={styles.ovAdd}>
              <TextInput
                style={[styles.timeInput, styles.ovDateInput]}
                value={ovDate}
                onChangeText={setOvDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <TextInput
                style={[styles.timeInput, ovOff && styles.disabled]}
                value={ovStart}
                editable={!ovOff}
                onChangeText={setOvStart}
                placeholder="09:00"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <Text style={styles.dash}>–</Text>
              <TextInput
                style={[styles.timeInput, ovOff && styles.disabled]}
                value={ovEnd}
                editable={!ovOff}
                onChangeText={setOvEnd}
                placeholder="18:00"
                placeholderTextColor={Colors.textPlaceholder}
              />
              <Pressable style={styles.restToggle} onPress={() => setOvOff((v) => !v)}>
                <View style={[styles.checkbox, ovOff && styles.checkboxOn]}>
                  {ovOff && <MaterialCommunityIcons name="check" size={12} color="#fff" />}
                </View>
                <Text style={styles.restLabel}>Rest</Text>
              </Pressable>
              <Pressable style={styles.addBtn} onPress={addOverride}>
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>
          </Card>

          <View style={styles.saveRow}>
            {sched.publishedLocked && (
              <Button label="Unlock for revision" variant="ghost" icon="lock-open-outline" onPress={unlockDraft} />
            )}
            <Button
              label={saving ? "Saving…" : "Save draft"}
              variant="ghost"
              icon="content-save-outline"
              loading={saving}
              disabled={publishing || sched.publishedLocked}
              onPress={save}
            />
            <Button
              label={publishing ? "Publishing…" : "Publish & notify"}
              icon="send-check-outline"
              loading={publishing}
              disabled={saving || sched.publishedLocked}
              onPress={publish}
            />
          </View>
          <Text style={styles.publishHint}>
            {sched.publishedLocked
              ? `Published schedule locked${sched.publishedBy ? ` by ${sched.publishedBy}` : ""}. Unlock before revising.`
              : "Save keeps a draft. Publish locks the schedule and notifies the employee."}
          </Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>
      )}

      {!sched && !loading && employees.length > 0 && (
        <EmptyState icon="account-clock-outline" text="Pick an employee to set their schedule" />
      )}
    </View>
  );
}

// Edits the work blocks of one shift. One block = a normal shift; add blocks for
// a split/broken shift (e.g. 09:00–14:00 and 17:00–21:00).
// Kills the browser's default black focus outline on web text inputs.
const webNoOutline = (Platform.OS === "web" ? { outlineStyle: "none" } : null) as object | null;

function BlockEditor({ shift, onChange }: { shift: Shift; onChange: (s: Shift) => void }) {
  const blocks = shiftBlocks(shift);
  const setBlock = (i: number, patch: Partial<ShiftBlock>) =>
    onChange(makeShift(false, blocks.map((b, j) => (j === i ? { ...b, ...patch } : b))));
  const addBlock = () => onChange(makeShift(false, [...blocks, { start: "17:00", end: "21:00" }]));
  const removeBlock = (i: number) => {
    const next = blocks.filter((_, j) => j !== i);
    onChange(makeShift(false, next.length ? next : [{ start: "09:00", end: "18:00" }]));
  };
  return (
    <View style={styles.blocks}>
      {blocks.map((b, i) => (
        <View key={i} style={styles.blockRow}>
          <TextInput
            style={[styles.timeInput, webNoOutline]}
            value={b.start}
            onChangeText={(t) => setBlock(i, { start: t })}
            placeholder="09:00"
            placeholderTextColor={Colors.textPlaceholder}
          />
          <Text style={styles.dash}>–</Text>
          <TextInput
            style={[styles.timeInput, webNoOutline]}
            value={b.end}
            onChangeText={(t) => setBlock(i, { end: t })}
            placeholder="18:00"
            placeholderTextColor={Colors.textPlaceholder}
          />
          {blocks.length > 1 && (
            <Pressable style={styles.blockDel} onPress={() => removeBlock(i)}>
              <MaterialCommunityIcons name="close" size={14} color={Colors.danger} />
            </Pressable>
          )}
          {i === 0 && blocks.length > 1 && <Text style={styles.splitTag}>Split</Text>}
        </View>
      ))}
      <Pressable style={styles.addBlockBtn} onPress={addBlock}>
        <MaterialCommunityIcons name="plus" size={14} color={Colors.primary} />
        <Text style={styles.addBlockText}>Add block (split shift)</Text>
      </Pressable>
    </View>
  );
}

function Stepper({ value, min = 0, onChange }: { value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - 1))}>
        <MaterialCommunityIcons name="minus" size={16} color={Colors.textPrimary} />
      </Pressable>
      <Text style={styles.stepVal}>{value}</Text>
      <Pressable style={styles.stepBtn} onPress={() => onChange(value + 1)}>
        <MaterialCommunityIcons name="plus" size={16} color={Colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: Colors.textFaint, fontSize: 13 },

  // Per-day block editor
  dayBlock: { paddingVertical: 14 },
  dayBlockRest: { backgroundColor: Colors.warmSurface, marginHorizontal: -18, paddingHorizontal: 18 },
  dayRow: { flexDirection: "row", alignItems: "flex-start", gap: 16, flexWrap: "wrap" },
  dayLabelCol: { width: 96, gap: 7, paddingTop: 2 },
  dayContent: { flexGrow: 1, flexBasis: 240, minWidth: 220, gap: 8 },
  dayActions: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
  dayRestText: { fontSize: 13, color: Colors.textFaint, fontStyle: "italic", paddingVertical: 9 },
  restPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: Colors.warmBorder, backgroundColor: Colors.cardSurface },
  restPillOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  restPillText: { fontSize: 12, fontWeight: "700", color: Colors.textMuted },
  restPillTextOn: { color: "#fff" },
  restBadge: { fontSize: 12, fontWeight: "700", color: Colors.textFaint, fontStyle: "italic", marginRight: 4 },
  copyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  copyBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  blocks: { gap: 8 },
  blockRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  blockDel: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.dangerTint, alignItems: "center", justifyContent: "center" },
  splitTag: { fontSize: 10, fontWeight: "800", color: Colors.primary, letterSpacing: 0.6, textTransform: "uppercase" },
  addBlockBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  addBlockText: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  pasteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: Colors.warmSurface,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: "dashed",
  },
  pasteText: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  copyDoneBtn: { alignSelf: "center", marginTop: 12, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 9, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  copyDoneText: { fontSize: 13, fontWeight: "700", color: Colors.textMuted },
  rotationBanner: { fontSize: 12, color: Colors.primaryDark, fontWeight: "600", lineHeight: 17, marginBottom: 8, marginTop: -4 },
  hoursChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 10, marginTop: -2, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  hoursChipWarn: { backgroundColor: "#FCF3E6", borderColor: Colors.warningDeep },
  hoursChipText: { fontSize: 12, fontWeight: "700", color: Colors.textMuted },
  hoursChipTextWarn: { color: Colors.warningDeep },

  // Rotation card
  rotHeaderRow: { flexDirection: "row", alignItems: "center" },
  rotBody: { marginTop: 16, gap: 14, borderTopWidth: 1, borderTopColor: Colors.hairline, paddingTop: 16 },
  rotTitle: { fontSize: 15, fontWeight: "700", color: Colors.textPrimary },
  rotHint: { fontSize: 12, color: Colors.textFaint, lineHeight: 17, marginTop: 3 },
  rotPresets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder },
  presetBtnOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  presetText: { fontSize: 12, fontWeight: "700", color: Colors.textPrimary },
  presetTextOn: { color: "#fff" },
  rotRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  rotLabel: { fontSize: 13, fontWeight: "700", color: Colors.textBody },
  rotDateInput: { width: 140 },
  rotGap: { width: 16 },
  rotSubLabel: { fontSize: 12, fontWeight: "700", color: Colors.textSubtle, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 },
  rotFields: { flexDirection: "row", gap: 24, flexWrap: "wrap", alignItems: "flex-start" },
  rotField: { gap: 8 },
  rotFieldLabel: { fontSize: 12, fontWeight: "700", color: Colors.textBody },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: Colors.warmBorder, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: Colors.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.warmSurface, borderWidth: 1, borderColor: Colors.warmBorder, alignItems: "center", justifyContent: "center" },
  stepVal: { minWidth: 28, textAlign: "center", fontSize: 15, fontWeight: "700", color: Colors.textPrimary, fontVariant: ["tabular-nums"] },

  weekRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, flexWrap: "wrap" },
  breakRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  breakSpacer: { flex: 1 },
  breakHint: { fontSize: 12, color: Colors.textFaint, marginTop: 12, lineHeight: 17 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  weekDay: {
    width: 42,
    fontSize: 12,
    fontWeight: "700",
    color: Colors.primary,
    backgroundColor: Colors.warmSurface,
    textAlign: "center",
    paddingVertical: 5,
    borderRadius: 8,
  },
  weekDayOff: { color: Colors.textFaint, backgroundColor: Colors.warmSurfaceAlt },
  weekDayFull: { fontSize: 14, fontWeight: "700", color: Colors.textPrimary },
  timeInput: {
    width: 92,
    height: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
    backgroundColor: Colors.warmSurface,
    paddingHorizontal: 10,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  disabled: { opacity: 0.4 },
  dash: { color: Colors.textFaint },
  restToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.textPlaceholder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  restLabel: { fontSize: 13, fontWeight: "600", color: Colors.textMuted },

  ovRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.hairline },
  ovDate: { width: 200, fontSize: 14, fontWeight: "600", color: Colors.textPrimary },
  ovShift: { flex: 1, fontSize: 14, color: Colors.textMuted },
  ovDel: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.dangerTint, alignItems: "center", justifyContent: "center" },
  ovAdd: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.hairline, flexWrap: "wrap" },
  ovDateInput: { width: 130 },
  addBtn: { height: 38, paddingHorizontal: 16, borderRadius: 9, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  saveBtn: { height: 50, borderRadius: 13, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center", marginTop: 6 },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  saveRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 6, flexWrap: "wrap" },
  publishHint: { fontSize: 12, color: Colors.textFaint, marginTop: 8, textAlign: "right" },
  message: { marginTop: 12, textAlign: "center", color: Colors.textMuted, fontWeight: "600", fontSize: 13 },

  // Employee dropdown + import/export buttons on one line.
  pickerRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, flexWrap: "wrap" },
  pickerCol: { flexGrow: 1, flexBasis: 260, minWidth: 220 },
  pickerLabel: { fontSize: 12, fontWeight: "700", color: Colors.textBody, marginBottom: 6, letterSpacing: 0.1 },
  pickerActions: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  importHint: { fontSize: 12, lineHeight: 17, color: Colors.textFaint, marginTop: 14 },
  mono: { fontWeight: "700", color: Colors.textMuted },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.warmBorder,
  },
  ghostBtnText: { color: Colors.textPrimary, fontWeight: "700", fontSize: 14 },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 11,
    backgroundColor: Colors.primary,
  },
  importBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
