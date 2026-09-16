import { Animated, Image, Pressable, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { measureCenterInto, trackCursor, viewportHeight } from "./web";
import type { MascotMood } from "./mascot";

// koboyo.com/page-mascot characters: two 3x3 webp sprite sheets per character.
// The site offers these files for download and self-hosting; we hotlink them.
export const SPRITE_BASE = "https://koboyo.com/page-mascot/mascots";

export const DEFAULT_MASCOT = "fox";

/** Row-major 3x3 grid order of the directions sheet. */
const DIRECTIONS = [
  "up-left",
  "up",
  "up-right",
  "left",
  "center",
  "right",
  "down-left",
  "down",
  "down-right",
] as const;
type Direction = (typeof DIRECTIONS)[number];

/** Gaze ring in clockwise angle order, starting at 0 rad (right). */
const RING: readonly Direction[] = [
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
  "up",
  "up-right",
];

/** Row-major 3x3 grid order of the reactions sheet. */
const REACTIONS = [
  "blink",
  "heart",
  "sparkle",
  "surprised",
  "wink",
  "bashful",
  "sleepy",
  "dizzy",
  "delighted",
] as const;
type Reaction = (typeof REACTIONS)[number];

const POKE_BONUS: readonly Reaction[] = ["heart", "sparkle", "delighted"];
const DEADZONE_PX = 70;
const RAPID_WINDOW_MS = 1600;
const DIZZY_THRESHOLD = 4;
const BLINK_TO_REACTION_MS = 120;
const REACTION_CLEAR_MS = 560;
const DIZZY_CLEAR_MS = 1100;
/** Cursor still this long with the agent idle: time for a nap. */
const SLEEP_AFTER_MS = 10_000;
const IDLE_TICK_MS = 1000;
/** Cursor parked on top of the mascot this long reads as staring. */
const STARE_AFTER_MS = 2000;
const WAKE_MS = 700;
const WINK_MS = 900;
const BASHFUL_MS = 1200;
const DROP_MS = 900;
const MOOD_FLASH_MS = 1400;
const GLANCE_EVERY_MS = 4500;
const GLANCE_MS = 1100;

// Their catalogue, in site order.
export const MASCOT_GROUPS: readonly { title: string; ids: readonly string[] }[] = [
  {
    title: "animals",
    ids: [
      "bear",
      "bunny",
      "cat",
      "deer",
      "dino",
      "fox",
      "frog",
      "hamster",
      "hedgehog",
      "koala",
      "mouse",
      "otter",
      "owl",
      "panda",
      "penguin",
      "pug",
      "raccoon",
      "redpanda",
      "sheep",
      "sloth",
      "tiger",
    ],
  },
  {
    title: "people",
    ids: [
      "afro",
      "astronaut",
      "bald",
      "ballerina",
      "beard",
      "builder",
      "cap",
      "chef",
      "glasses",
      "grandpa",
      "granny",
      "hijabi",
      "kamran",
      "nurse",
      "pirate",
      "scientist",
      "sikh",
      "skater",
      "wizard",
    ],
  },
  {
    title: "things",
    ids: [
      "clockwork",
      "crt",
      "cube",
      "drone",
      "gearbot",
      "knight",
      "lantern",
      "postbot",
      "radio",
      "rocket",
      "scout",
      "toaster",
      "tv",
    ],
  },
  {
    title: "fox styles",
    ids: ["fox-ink", "fox-sketch", "fox-riso", "fox-paper", "fox-pixel"],
  },
];

export function mascotLabel(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const MOOD_REACTION: Partial<Record<MascotMood, Reaction>> = {
  alert: "surprised",
  happy: "delighted",
  sad: "sleepy",
};

function Sprite({ id, kind, frame, size }: { id: string; kind: "directions" | "reactions"; frame: number; size: number }) {
  const col = frame % 3;
  const row = Math.floor(frame / 3);
  // Translate (not margins) — react-native-web's Image doesn't honor margin shifts
  // reliably, but transforms always apply.
  return (
    <View style={{ width: size, height: size, overflow: "hidden" }}>
      <Image
        source={{ uri: `${SPRITE_BASE}/${id}-${kind}.webp` }}
        style={{
          width: size * 3,
          height: size * 3,
          transform: [{ translateX: -col * size }, { translateY: -row * size }],
        }}
      />
    </View>
  );
}

/** Static thumb for the picker grid (center gaze). */
export function MascotThumb({ id, size }: { id: string; size: number }) {
  return <Sprite id={id} kind="directions" frame={DIRECTIONS.indexOf("center")} size={size} />;
}

export type MascotGesture = "dragging" | "dropped" | "flung";

export function KoboyoMascot({
  id,
  size,
  mood = "neutral",
  gesture = null,
  onSleepChange,
}: {
  id: string;
  size: number;
  mood?: MascotMood;
  gesture?: MascotGesture | null;
  onSleepChange?: (asleep: boolean) => void;
}) {
  const [direction, setDirection] = useState<Direction>("center");
  // Every one-shot reaction (poke, mood change, wink, stare, wake, drop) runs through
  // this single slot: the newest one wins, so reactions replace each other instead of
  // fighting over the same sprite layer.
  const [reactionFlash, setReactionFlash] = useState<Reaction | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [glancing, setGlancing] = useState(false);
  const lastMood = useRef<MascotMood>(mood);
  const squash = useRef(new Animated.Value(0)).current;
  const rootRef = useRef<View>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pokes = useRef({ count: 0, at: 0 });
  // Read by the cursor tracker and the idle ticker, which are both set up once.
  const idle = useRef({ since: Date.now(), hovered: false, stared: false, asleep: false });

  const flash = useCallback((reaction: Reaction, ms: number) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setReactionFlash(reaction);
    timers.current.push(setTimeout(() => setReactionFlash(null), ms));
  }, []);

  const wake = useCallback(
    (surprised: boolean) => {
      idle.current.since = Date.now();
      idle.current.stared = false;
      if (!idle.current.asleep) return;
      idle.current.asleep = false;
      setAsleep(false);
      if (surprised) flash("surprised", WAKE_MS);
    },
    [flash],
  );

  useEffect(() => {
    const tracker = trackCursor((x, y) => {
      measureCenterInto(rootRef.current, centerRef.current);
      const center = centerRef.current;
      if (!center.x && !center.y) return;
      const dx = x - center.x;
      const dy = y - center.y;
      const near = Math.hypot(dx, dy) < DEADZONE_PX;
      idle.current.hovered = near;
      wake(true);
      if (near) {
        setDirection("center");
        return;
      }
      const ringIndex = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
      setDirection(RING[ringIndex]);
    });
    return () => tracker.dispose();
  }, [wake]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Naps and stares share one ticker: both are just "the cursor stopped moving".
  // Only the nap waits for the agent to be idle too — being stared at is a direct
  // interaction, like a poke, so it lands even mid-run.
  useEffect(() => {
    const interval = setInterval(() => {
      if (gesture) return;
      const still = Date.now() - idle.current.since;
      if (still >= SLEEP_AFTER_MS && mood !== "focus") {
        if (idle.current.asleep) return;
        idle.current.asleep = true;
        setAsleep(true);
        return;
      }
      if (idle.current.hovered && !idle.current.stared && still >= STARE_AFTER_MS) {
        idle.current.stared = true;
        flash("bashful", BASHFUL_MS);
      }
    }, IDLE_TICK_MS);
    return () => clearInterval(interval);
  }, [mood, gesture, flash]);

  useEffect(() => onSleepChange?.(asleep), [asleep, onSleepChange]);

  // A workspace mood change flashes its reaction briefly, then gaze resumes —
  // holding the reaction forever would freeze the sprite on one frame.
  useEffect(() => {
    if (mood === lastMood.current) return;
    lastMood.current = mood;
    wake(false);
    const reaction = MOOD_REACTION[mood];
    if (reaction) flash(reaction, MOOD_FLASH_MS);
  }, [mood, flash, wake]);

  // While the agent works, glance at the transcript now and then instead of staring
  // at the cursor the whole time.
  useEffect(() => {
    if (mood !== "focus") return;
    const interval = setInterval(() => {
      setGlancing(true);
      timers.current.push(setTimeout(() => setGlancing(false), GLANCE_MS));
    }, GLANCE_EVERY_MS);
    return () => clearInterval(interval);
  }, [mood]);

  // Picking a mascot in the popover is the only way `id` changes: say hello.
  const known = useRef(id);
  useEffect(() => {
    if (id === known.current) return;
    known.current = id;
    flash("wink", WINK_MS);
  }, [id, flash]);

  // Being thrown is dizzying; being set down is a little embarrassing.
  useEffect(() => {
    if (gesture === "flung") flash("dizzy", DIZZY_CLEAR_MS);
    else if (gesture === "dropped") flash("bashful", DROP_MS);
    if (gesture) wake(false);
  }, [gesture, flash, wake]);

  // Idle blinking so they feel alive even when the cursor is away — but not mid-nap,
  // where an open-eyed blink would break the illusion.
  useEffect(() => {
    if (asleep) return;
    const interval = setInterval(() => {
      setReactionFlash((current) => {
        if (current) return current;
        timers.current.push(setTimeout(() => setReactionFlash(null), 160));
        return "blink";
      });
    }, 3600);
    return () => clearInterval(interval);
  }, [asleep]);

  const poke = useCallback(() => {
    wake(false);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const now = Date.now();
    const state = pokes.current;
    state.count = now - state.at < RAPID_WINDOW_MS ? state.count + 1 : 1;
    state.at = now;
    if (state.count >= DIZZY_THRESHOLD) {
      state.count = 0;
      setReactionFlash("dizzy");
      timers.current.push(setTimeout(() => setReactionFlash(null), DIZZY_CLEAR_MS));
    } else {
      setReactionFlash("blink");
      timers.current.push(
        setTimeout(() => setReactionFlash(POKE_BONUS[(state.count - 1) % POKE_BONUS.length]), BLINK_TO_REACTION_MS),
      );
      timers.current.push(setTimeout(() => setReactionFlash(null), REACTION_CLEAR_MS));
    }
    // squash-and-stretch, 420ms, matching their keyframes
    Animated.sequence([
      Animated.timing(squash, { toValue: 1, duration: 75, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 2, duration: 114, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 3, duration: 113, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 0, duration: 118, useNativeDriver: false }),
    ]).start();
  }, [squash, wake]);

  // Priority: what is happening to the mascot right now beats what it feels, which
  // beats being asleep.
  const reaction: Reaction | null =
    gesture === "dragging" ? "surprised" : (reactionFlash ?? (asleep ? "sleepy" : null));
  const glance: Direction = centerRef.current.y > viewportHeight() / 2 ? "up" : "down";
  const directionFrame = DIRECTIONS.indexOf(glancing ? glance : direction);
  const reactionFrame = REACTIONS.indexOf(reaction ?? "blink");
  const squashScaleX = squash.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 1.1, 0.95, 1.03] });
  const squashScaleY = squash.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 0.86, 1.08, 0.97] });

  return (
    <View ref={rootRef}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Poke ${mascotLabel(id)}`}
        onPress={poke}
        hitSlop={4}
      >
        <Animated.View
          style={{
            width: size,
            height: size,
            transform: [{ scaleX: squashScaleX }, { scaleY: squashScaleY }],
          }}
        >
          <View style={{ opacity: reaction ? 0 : 1 }}>
            <Sprite id={id} kind="directions" frame={directionFrame} size={size} />
          </View>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: reaction ? 1 : 0,
            }}
          >
            <Sprite id={id} kind="reactions" frame={reactionFrame} size={size} />
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}
