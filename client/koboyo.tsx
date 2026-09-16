import { Animated, Image, Pressable, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { measureCenterInto, trackCursor } from "./web";
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

export function KoboyoMascot({
  id,
  size,
  mood = "neutral",
}: {
  id: string;
  size: number;
  mood?: MascotMood;
}) {
  const [direction, setDirection] = useState<Direction>("center");
  const [pokeReaction, setPokeReaction] = useState<Reaction | null>(null);
  const [moodFlash, setMoodFlash] = useState<Reaction | null>(null);
  const lastMood = useRef<MascotMood>(mood);
  const squash = useRef(new Animated.Value(0)).current;
  const rootRef = useRef<View>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pokes = useRef({ count: 0, at: 0 });

  useEffect(() => {
    const tracker = trackCursor((x, y) => {
      measureCenterInto(rootRef.current, centerRef.current);
      const center = centerRef.current;
      if (!center.x && !center.y) return;
      const dx = x - center.x;
      const dy = y - center.y;
      if (Math.hypot(dx, dy) < DEADZONE_PX) {
        setDirection("center");
        return;
      }
      const ringIndex = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
      setDirection(RING[ringIndex]);
    });
    return () => tracker.dispose();
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A workspace mood change flashes its reaction briefly, then gaze resumes —
  // holding the reaction forever would freeze the sprite on one frame.
  useEffect(() => {
    if (mood === lastMood.current) return;
    lastMood.current = mood;
    const flash = MOOD_REACTION[mood];
    if (!flash) return;
    setMoodFlash(flash);
    const t = setTimeout(() => setMoodFlash(null), 1400);
    return () => clearTimeout(t);
  }, [mood]);

  // Idle blinking so they feel alive even when the cursor is away.
  useEffect(() => {
    const interval = setInterval(() => {
      setPokeReaction((current) => {
        if (current) return current;
        timers.current.push(setTimeout(() => setPokeReaction(null), 160));
        return "blink";
      });
    }, 3600);
    return () => clearInterval(interval);
  }, []);

  const poke = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const now = Date.now();
    const state = pokes.current;
    state.count = now - state.at < RAPID_WINDOW_MS ? state.count + 1 : 1;
    state.at = now;
    if (state.count >= DIZZY_THRESHOLD) {
      state.count = 0;
      setPokeReaction("dizzy");
      timers.current.push(setTimeout(() => setPokeReaction(null), DIZZY_CLEAR_MS));
    } else {
      setPokeReaction("blink");
      timers.current.push(
        setTimeout(() => setPokeReaction(POKE_BONUS[(state.count - 1) % POKE_BONUS.length]), BLINK_TO_REACTION_MS),
      );
      timers.current.push(setTimeout(() => setPokeReaction(null), REACTION_CLEAR_MS));
    }
    // squash-and-stretch, 420ms, matching their keyframes
    Animated.sequence([
      Animated.timing(squash, { toValue: 1, duration: 75, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 2, duration: 114, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 3, duration: 113, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 0, duration: 118, useNativeDriver: false }),
    ]).start();
  }, [squash]);

  const reaction = pokeReaction ?? moodFlash;
  const directionFrame = DIRECTIONS.indexOf(direction);
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
