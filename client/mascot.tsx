import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
} from "@getpaseo/plugin/client";
import { useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { mascotSettings } from "../shared/mascot-settings";
import { KoboyoMascot, MascotThumb, MASCOT_GROUPS, mascotLabel, DEFAULT_MASCOT } from "./koboyo";
import type { MascotGesture } from "./koboyo";
import { NAME_MAX_LENGTH, PILL_TITLE } from "../shared/mascot-settings";
import { Animated, Easing, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useEffect, useRef, useState } from "react";
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
export function MascotPickerContent({ theme, close }: PluginButtonContentProps) {
  const { id, settings } = useSelectedMascot();
  // Picking is the whole point of the popover, so it closes on any choice — but only
  // once the choice is safe: while settings are still loading there is no revision to
  // save against, and closing would drop the pick silently. The save itself survives
  // the unmount (the host runs it as a mutation and writes the shared query cache).
  //
  // The name is typed freely and travels with whatever is saved next — a pick, Enter,
  // or the popover closing. One save per action: the host rejects a second save
  // against the same revision, so a name save racing a pick would drop the pick.
  const savedName = settings.status === "ready" ? settings.values.name : "";
  const [name, setName] = useState(savedName);
  useEffect(() => setName(savedName), [savedName]);
  const latest = useRef({ settings, name });
  latest.current = { settings, name };
  const persist = (patch: { mascot?: string }) => {
    const { settings: current, name: typed } = latest.current;
    if (current.status !== "ready") return;
    const next = { ...current.values, ...patch, name: typed.trim().slice(0, NAME_MAX_LENGTH) };
    if (next.mascot === current.values.mascot && next.name === current.values.name) return;
    latest.current = { settings: { ...current, values: next }, name: next.name };
    void current.save(next, current.revision);
  };
  const select = (next: string) => {
    if (settings.status !== "ready") return;
    persist({ mascot: next });
    close();
  };
  useEffect(() => () => persist({}), []);
  return (
    <View style={{ width: 300 }}>
      <Text style={{ fontSize: 13, color: theme.colors.foreground, marginBottom: 8 }}>
        Choose a mascot
      </Text>
      <TextInput
        accessibilityLabel="Mascot name"
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => persist({})}
        placeholder={`Name your ${mascotLabel(id).toLowerCase()}`}
        placeholderTextColor={theme.colors.foregroundMuted}
        maxLength={NAME_MAX_LENGTH}
        autoCorrect={false}
        style={{
          fontSize: 12,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingVertical: 6,
          paddingHorizontal: 10,
        }}
      />
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingBottom: 6 }}>
        {MASCOT_GROUPS.map((group, index) => (
          <View key={group.title}>
            <Text
              style={{
                marginTop: index === 0 ? 8 : 12,
                marginBottom: 4,
                fontSize: 11,
                color: theme.colors.foregroundMuted,
              }}
            >
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
                    width: "25%",
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
                    numberOfLines={1}
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
      </ScrollView>
    </View>
  );
}

/** Composer-pill icon: the mascot perches on the pill, spilling out of the host's icon box. */
export function MascotFaceIcon(props: PluginButtonIconProps) {
  const { size, workspaceId, theme } = props;
  const { id, settings } = useSelectedMascot();
  const name = settings.status === "ready" ? settings.values.name : "";
  const status = useWorkspace(workspaceId, (workspace) => workspace.status);
  const mood = (status && MOOD_BY_STATUS[status]) || "neutral";
  const slotRef = useRef<View>(null);
  const face = size * PILL_FACE_SCALE;
  const bob = useRef(new Animated.Value(0)).current;

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
  // is saved. Left click pokes; right click opens the host picker.
  const position = settings.status === "ready" ? settings.values.position : null;
  useEffect(() => {
    applyFixedPosition(anchorRef.current, position ? clampToViewport(position, face) : null);
    return () => applyFixedPosition(anchorRef.current, null);
  }, [position, face]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [gesture, setGesture] = useState<MascotGesture | null>(null);
  const [pokes, setPokes] = useState(0);
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined;
    const stop = makeDraggable(slotRef.current, anchorRef.current, {
      onStart: () => setGesture("dragging"),
      onTap: () => setPokes((count) => count + 1),
      onDrop: (dropped, flung) => {
        setGesture(flung ? "flung" : "dropped");
        clear = setTimeout(() => setGesture(null), GESTURE_CLEAR_MS);
        const current = settingsRef.current;
        if (current.status !== "ready") return;
        void current.save({ ...current.values, position: dropped }, current.revision);
      },
    });
    return () => {
      if (clear) clearTimeout(clear);
      stop();
    };
  }, []);

  // Slow idle bob, so the overflow reads as a deliberate perch rather than clipping;
  // a napping mascot breathes slower.
  const [napping, setNapping] = useState(false);
  useEffect(() => {
    const duration = napping ? NAP_BOB_MS : BOB_MS;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, napping]);

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
        <KoboyoMascot id={id} size={face} mood={mood} gesture={gesture} pokes={pokes} onSleepChange={setNapping} />
        {name ? (
          // A wrapper wider than the face, so the tag centres under it. (RN-web caps a
          // single-line Text at its parent's width, so the Text cannot be the wide one.)
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: face * NAME_TOP, left: -face, width: face * 3, alignItems: "center" }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontSize: face * NAME_SCALE,
                fontFamily: NAME_FONT,
                fontWeight: "600",
                letterSpacing: 0.3,
                color: theme.colors.foreground,
                backgroundColor: theme.colors.surface2,
                borderColor: theme.colors.border,
                borderWidth: 1,
                borderRadius: 999,
                paddingHorizontal: 7,
                paddingVertical: 1,
                overflow: "hidden",
              }}
            >
              {name}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Mascot geometry, all relative to the host's icon slot (14px in the composer). */
const PILL_FACE_SCALE = 6; // rendered face size (~84px)
const PILL_LIFT = 0.12; // how far above the slot the mascot sits
const PILL_SLOT_WIDTH = 0.78; // horizontal room the mascot reserves on the row
const PILL_SLOT_HEIGHT = 0.45; // hit area height, kept under the composer row height
const NAME_TOP = 0.8; // the name tag hangs from the feet, riding the composer's top edge
const NAME_SCALE = 0.12; // ~10px at the default face size
// A rounded face for a pet's name tag; every entry is a stock font somewhere.
const NAME_FONT = Platform.select({
  web: '"Arial Rounded MT Bold", "SF Pro Rounded", Nunito, "Varela Round", system-ui, sans-serif',
  default: undefined,
});
const BOB_MS = 1500;
const NAP_BOB_MS = 3200;
/** How long a drop reaction owns the sprite before normal gaze resumes. */
const GESTURE_CLEAR_MS = 1200;

const MOOD_BY_STATUS: Record<string, MascotMood> = {
  running: "focus",
  needs_input: "alert",
  attention: "alert",
  failed: "sad",
  done: "happy",
};

