import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
} from "@getpaseo/plugin/client";
import { useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { mascotSettings } from "../shared/mascot-settings";
import { KoboyoMascot, MascotThumb, MASCOT_GROUPS, mascotLabel, DEFAULT_MASCOT } from "./koboyo";
import { PILL_TITLE, updatePillLabels } from "./pill-registry";
import { Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useRef } from "react";
import { perchOnHostButton, suppressHostTooltip } from "./web";
import { applyFixedPosition, clampToViewport, makeDraggable } from "./drag";

export type MascotMood = "neutral" | "focus" | "alert" | "happy" | "sad";

function useSelectedMascot(): { id: string; settings: ReturnType<typeof useSettings<typeof mascotSettings.schema>> } {
  const settings = useSettings(mascotSettings);
  const stored = settings.status === "ready" ? settings.values.mascot : DEFAULT_MASCOT;
  const id = stored === "mochi" ? DEFAULT_MASCOT : stored;
  return { id, settings };
}

/** Picker popover over the koboyo catalogue. */
export function MascotPickerContent({ theme }: PluginButtonContentProps) {
  const { id, settings } = useSelectedMascot();
  const select = (next: string) => {
    if (settings.status !== "ready" || next === settings.values.mascot) return;
    void settings.save({ ...settings.values, mascot: next }, settings.revision);
  };
  const groups = MASCOT_GROUPS;
  return (
    <View style={{ width: 300 }}>
      <Text style={{ fontSize: 13, color: theme.colors.foreground, marginBottom: 4 }}>
        Choose a mascot
      </Text>
      <ScrollView style={{ maxHeight: 380 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {groups.map((group) => (
            <View key={group.title} style={{ width: "100%" }}>
              <Text style={{ marginTop: 10, marginBottom: 4, fontSize: 11, color: theme.colors.foregroundMuted }}>
                {group.title}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {group.ids.map((mascotId) => (
                  <Pressable
                    key={mascotId}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${mascotLabel(mascotId)}`}
                    onPress={() => select(mascotId)}
                    hitSlop={2}
                    style={{
                      width: "23%",
                      alignItems: "center",
                      paddingVertical: 8,
                      borderRadius: 10,
                      backgroundColor: id === mascotId ? theme.colors.surface2 : "transparent",
                    }}
                  >
                    <View style={{ height: 44, justifyContent: "center", marginBottom: 6 }}>
                      <MascotThumb id={mascotId} size={44} />
                    </View>
                    <Text
                      style={{
                        fontSize: 10,
                        textAlign: "center",
                        color: id === mascotId ? theme.colors.foreground : theme.colors.foregroundMuted,
                      }}
                    >
                      {mascotLabel(mascotId)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Composer-pill icon: the mascot perches on the pill, spilling out of the host's icon box. */
export function MascotFaceIcon(props: PluginButtonIconProps) {
  const { size, workspaceId } = props;
  const { id, settings } = useSelectedMascot();
  const status = useWorkspace(workspaceId, (workspace) => workspace.status);
  const mood = (status && MOOD_BY_STATUS[status]) || "neutral";
  const slotRef = useRef<View>(null);
  const face = size * PILL_FACE_SCALE;
  const bob = useRef(new Animated.Value(0)).current;

  // Keep every pill's label in sync with the selection.
  useEffect(() => {
    updatePillLabels(mascotLabel(id));
  }, [id]);

  // Drop the host's pill chrome (background, border, label) and its 16px icon clip,
  // leaving the mascot alone on the composer row. The host button is what the picker
  // popover anchors to, so dragging moves the button itself and the popover follows.
  const anchorRef = useRef<unknown>(null);
  useEffect(() => {
    const perch = perchOnHostButton(slotRef.current);
    anchorRef.current = perch.button;
    const stopTooltip = suppressHostTooltip(PILL_TITLE);
    return () => {
      stopTooltip();
      perch.restore();
    };
  }, []);

  // Free dragging: the mascot can live anywhere in the window, and its resting place
  // is saved. A plain click still reaches the host button and opens the picker.
  const position = settings.status === "ready" ? settings.values.position : null;
  useEffect(() => {
    applyFixedPosition(anchorRef.current, position ? clampToViewport(position, face) : null);
    return () => applyFixedPosition(anchorRef.current, null);
  }, [position, face]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(
    () =>
      makeDraggable(slotRef.current, anchorRef.current, (dropped) => {
        const current = settingsRef.current;
        if (current.status !== "ready") return;
        void current.save({ ...current.values, position: dropped }, current.revision);
      }),
    [],
  );

  // Slow idle bob, so the overflow reads as a deliberate perch rather than clipping.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  const lift = face * PILL_LIFT;
  const float = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] });

  return (
    <View
      ref={slotRef}
      testID="mascot-slot"
      style={{
        width: face * PILL_SLOT_WIDTH,
        height: face * PILL_SLOT_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={{ transform: [{ translateY: Animated.add(float, -lift) }] }}>
        <KoboyoMascot id={id} size={face} mood={mood} />
      </Animated.View>
    </View>
  );
}

/** Mascot geometry, all relative to the host's icon slot (14px in the composer). */
const PILL_FACE_SCALE = 6; // rendered face size (~84px)
const PILL_LIFT = 0.12; // how far above the slot the mascot sits
const PILL_SLOT_WIDTH = 0.78; // horizontal room the mascot reserves on the row
const PILL_SLOT_HEIGHT = 0.45; // hit area height, kept under the composer row height

const MOOD_BY_STATUS: Record<string, MascotMood> = {
  running: "focus",
  needs_input: "alert",
  attention: "alert",
  failed: "sad",
  done: "happy",
};

