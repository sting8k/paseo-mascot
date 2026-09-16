import { Animated, Image, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { measureCenterInto, trackCursor, trackTyping, viewportHeight } from "./web";
import type { Rect } from "./web";
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
/** A field this close is being sat on, not looked at; anything further gets a real glance. */
const TYPING_DEADZONE_PX = 12;
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
// A pet notices a hand that darts or moves somewhere new, not one that creeps; and
// it loses interest after a moment and looks ahead again.
const NOTICE_SPEED_PX_PER_MS = 1.2;
const NOTICE_DISTANCE_PX = 90;
const INTEREST_MS = 2500;
// Unprompted, just to be unpredictable.
const WHIM_MIN_MS = 20_000;
const WHIM_MAX_MS = 50_000;
const WHIM_MS = 900;
const WHIMS: readonly Reaction[] = ["sparkle", "wink", "delighted", "heart", "surprised"];
const BLINK_MS = 160;
const BLINK_EVERY_MS = 3600;

// Reactions share one sprite layer, so they need a pecking order: something done to
// the mascot (poke, stare, drop, hello) must not be cut short by a workspace mood
// flicker, and neither should be cut by an idle blink.
const AMBIENT = 0;
const MOOD = 1;
const DIRECT = 2;
/** `holdFrom`: once past it, any user activity ends the reaction early. */
type Showing = { priority: number; timer: ReturnType<typeof setTimeout>; holdFrom?: number };

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

// Ids that title-casing gets wrong.
const LABELS: Record<string, string> = { redpanda: "Red Panda", crt: "CRT", tv: "TV" };

export function mascotLabel(id: string): string {
  return (
    LABELS[id] ??
    id
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

// No sad frame on the sheet; dizzy reads as "that went wrong" better than a sleepy
// face that looks like a nap.
const MOOD_REACTION: Partial<Record<MascotMood, Reaction>> = {
  focus: "sparkle",
  alert: "surprised",
  happy: "delighted",
  sad: "dizzy",
};

/** The point of `rect` closest to `from` — what to look at when facing a wide box. */
function nearestPoint(rect: Rect, from: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(from.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(from.y, rect.y), rect.y + rect.height),
  };
}

/** Which of the nine gaze frames points from `center` at (x, y). */
function directionTo(center: { x: number; y: number }, x: number, y: number, deadzone = DEADZONE_PX): Direction {
  const dx = x - center.x;
  const dy = y - center.y;
  if (Math.hypot(dx, dy) < deadzone) return "center";
  return RING[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
}

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
  pokes = 0,
  onSleepChange,
}: {
  id: string;
  size: number;
  mood?: MascotMood;
  gesture?: MascotGesture | null;
  /** Bumped by the parent for every tap; the mascot owns what a poke does. */
  pokes?: number;
  onSleepChange?: (asleep: boolean) => void;
}) {
  const [direction, setDirection] = useState<Direction>("center");
  // Every one-shot reaction (poke, mood change, wink, stare, wake, drop) runs through
  // this single slot; `show` decides by priority whether a newcomer may take it over.
  const [reactionFlash, setReactionFlash] = useState<Reaction | null>(null);
  const showing = useRef<Showing | null>(null);
  const glanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pokeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [asleep, setAsleep] = useState(false);
  const [glancing, setGlancing] = useState(false);
  const [typingAt, setTypingAt] = useState<Direction | null>(null);
  const lastMood = useRef<MascotMood>(mood);
  const squash = useRef(new Animated.Value(0)).current;
  const rootRef = useRef<View>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const tally = useRef({ count: 0, at: 0 });
  // Read by the cursor tracker and the idle ticker, which are both set up once.
  const idle = useRef({ since: Date.now(), hovered: false, stared: false, asleep: false });
  // Where the cursor was last noticed, and until when it holds the mascot's interest.
  const noticed = useRef({ x: 0, y: 0, at: 0, until: 0 });

  /** Show `reaction` for `ms` unless something more important is still on screen. Returns the slot it took, if any. */
  const show = useCallback((reaction: Reaction, ms: number, priority: number, holdFrom?: number): Showing | null => {
    const current = showing.current;
    if (current && current.priority > priority) return null;
    if (current) clearTimeout(current.timer);
    const slot: Showing = {
      priority,
      holdFrom,
      timer: setTimeout(() => {
        if (showing.current !== slot) return;
        showing.current = null;
        setReactionFlash(null);
      }, ms),
    };
    showing.current = slot;
    setReactionFlash(reaction);
    return slot;
  }, []);

  // `byUser`: cursor or keyboard activity, as opposed to something happening to the
  // mascot. Only that ends a held reaction (and startles a sleeper).
  const wake = useCallback(
    (byUser: boolean) => {
      idle.current.since = Date.now();
      const held = showing.current;
      if (byUser && held?.holdFrom !== undefined && Date.now() >= held.holdFrom) {
        clearTimeout(held.timer);
        showing.current = null;
        setReactionFlash(null);
      }
      if (!idle.current.asleep) return;
      idle.current.asleep = false;
      setAsleep(false);
      if (byUser) show("surprised", WAKE_MS, DIRECT);
    },
    [show],
  );

  useEffect(() => {
    const tracker = trackCursor((x, y) => {
      measureCenterInto(rootRef.current, centerRef.current);
      const center = centerRef.current;
      if (!center.x && !center.y) return;
      const next = directionTo(center, x, y);
      idle.current.hovered = next === "center";
      // A hand that merely trembles over the mascot is still one stare, not a new one.
      if (!idle.current.hovered) idle.current.stared = false;
      wake(true);
      const seen = noticed.current;
      const now = Date.now();
      const moved = Math.hypot(x - seen.x, y - seen.y);
      const speed = seen.at ? moved / Math.max(1, now - seen.at) : 0;
      seen.at = now;
      // Hovering is up close and always noticed; otherwise only a dart or a real
      // relocation earns a look, and once it has one, it keeps it for a moment.
      const notable = next === "center" || speed >= NOTICE_SPEED_PX_PER_MS || moved >= NOTICE_DISTANCE_PX;
      if (!notable && now >= seen.until) return;
      if (notable) {
        seen.x = x;
        seen.y = y;
        seen.until = now + INTEREST_MS;
      }
      setDirection(next);
    });
    return () => tracker.dispose();
  }, [wake]);

  // Typing is where the user's attention actually is; the mouse just sits wherever it
  // was left. Watch the caret's field instead, and treat typing as being present.
  useEffect(() => {
    const tracker = trackTyping((field) => {
      if (!field) {
        setTypingAt(null);
        return;
      }
      measureCenterInto(rootRef.current, centerRef.current);
      const center = centerRef.current;
      if (!center.x && !center.y) return;
      const look = nearestPoint(field, center);
      wake(true);
      setTypingAt(directionTo(center, look.x, look.y, TYPING_DEADZONE_PX));
    });
    return () => tracker.dispose();
  }, [wake]);

  useEffect(
    () => () => {
      if (showing.current) clearTimeout(showing.current.timer);
      if (glanceTimer.current) clearTimeout(glanceTimer.current);
      if (pokeTimer.current) clearTimeout(pokeTimer.current);
    },
    [],
  );

  // Naps, stares and boredom share one ticker: all are just "the cursor stopped".
  // A running agent does not keep the mascot up — the user being away is what matters.
  useEffect(() => {
    const interval = setInterval(() => {
      if (gesture) return;
      const now = Date.now();
      if (now >= noticed.current.until) setDirection("center");
      const still = now - idle.current.since;
      if (still >= SLEEP_AFTER_MS) {
        if (idle.current.asleep) return;
        idle.current.asleep = true;
        setAsleep(true);
        return;
      }
      if (idle.current.hovered && !idle.current.stared && still >= STARE_AFTER_MS) {
        idle.current.stared = true;
        show("bashful", BASHFUL_MS, DIRECT);
      }
    }, IDLE_TICK_MS);
    return () => clearInterval(interval);
  }, [gesture, show]);

  useEffect(() => onSleepChange?.(asleep), [asleep, onSleepChange]);

  // A workspace mood change flashes its reaction briefly, then gaze resumes —
  // holding the reaction forever would freeze the sprite on one frame. Finishing a
  // run is the exception: stay pleased until the user comes back (or the nap timer
  // would have fired anyway).
  useEffect(() => {
    if (mood === lastMood.current) return;
    lastMood.current = mood;
    wake(false);
    const reaction = MOOD_REACTION[mood];
    if (!reaction) return;
    if (mood === "happy") show(reaction, SLEEP_AFTER_MS, MOOD, Date.now() + MOOD_FLASH_MS);
    else show(reaction, MOOD_FLASH_MS, MOOD);
  }, [mood, show, wake]);

  // While the agent works, glance at the transcript now and then instead of staring
  // at the cursor the whole time.
  useEffect(() => {
    if (mood !== "focus") return;
    const interval = setInterval(() => {
      setGlancing(true);
      if (glanceTimer.current) clearTimeout(glanceTimer.current);
      glanceTimer.current = setTimeout(() => setGlancing(false), GLANCE_MS);
    }, GLANCE_EVERY_MS);
    return () => {
      clearInterval(interval);
      if (glanceTimer.current) clearTimeout(glanceTimer.current);
      setGlancing(false);
    };
  }, [mood]);

  // Picking a mascot in the popover is the only way `id` changes: say hello.
  const known = useRef(id);
  useEffect(() => {
    if (id === known.current) return;
    known.current = id;
    show("wink", WINK_MS, DIRECT);
  }, [id, show]);

  // Being thrown is dizzying; being set down is a little embarrassing.
  useEffect(() => {
    if (gesture === "flung") show("dizzy", DIZZY_CLEAR_MS, DIRECT);
    else if (gesture === "dropped") show("bashful", DROP_MS, DIRECT);
    if (gesture) wake(false);
  }, [gesture, show, wake]);

  // Now and then, a reaction for no reason at all. Lowest priority, like a blink.
  useEffect(() => {
    if (asleep) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        show(WHIMS[Math.floor(Math.random() * WHIMS.length)], WHIM_MS, AMBIENT);
        schedule();
      }, WHIM_MIN_MS + Math.random() * (WHIM_MAX_MS - WHIM_MIN_MS));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [asleep, show]);

  // Idle blinking so they feel alive even when the cursor is away — but not mid-nap,
  // where an open-eyed blink would break the illusion. Lowest priority: it yields to
  // everything else, and everything else is allowed to cut it short.
  useEffect(() => {
    if (asleep) return;
    const interval = setInterval(() => show("blink", BLINK_MS, AMBIENT), BLINK_EVERY_MS);
    return () => clearInterval(interval);
  }, [asleep, show]);

  const poke = useCallback(() => {
    wake(false);
    if (pokeTimer.current) clearTimeout(pokeTimer.current);
    const now = Date.now();
    const state = tally.current;
    state.count = now - state.at < RAPID_WINDOW_MS ? state.count + 1 : 1;
    state.at = now;
    if (state.count >= DIZZY_THRESHOLD) {
      state.count = 0;
      show("dizzy", DIZZY_CLEAR_MS, DIRECT);
    } else {
      // A quick blink, then the real reaction — as long as nothing took the slot meanwhile.
      const slot = show("blink", REACTION_CLEAR_MS, DIRECT);
      const bonus = POKE_BONUS[(state.count - 1) % POKE_BONUS.length];
      pokeTimer.current = setTimeout(() => {
        if (showing.current === slot) setReactionFlash(bonus);
      }, BLINK_TO_REACTION_MS);
    }
    // squash-and-stretch, 420ms, matching their keyframes
    Animated.sequence([
      Animated.timing(squash, { toValue: 1, duration: 75, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 2, duration: 114, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 3, duration: 113, useNativeDriver: false }),
      Animated.timing(squash, { toValue: 0, duration: 118, useNativeDriver: false }),
    ]).start();
  }, [squash, wake, show]);

  const seenPokes = useRef(pokes);
  useEffect(() => {
    if (pokes === seenPokes.current) return;
    seenPokes.current = pokes;
    poke();
  }, [pokes, poke]);

  // Priority: what is happening to the mascot right now beats what it feels, which
  // beats being asleep.
  const reaction: Reaction | null =
    gesture === "dragging" ? "surprised" : (reactionFlash ?? (asleep ? "sleepy" : null));
  // Watching the user type beats an ambient glance at the transcript, which in turn
  // beats following a mouse nobody is holding.
  const glance: Direction = centerRef.current.y > viewportHeight() / 2 ? "up" : "down";
  const gaze = typingAt ?? (glancing ? glance : direction);
  const directionFrame = DIRECTIONS.indexOf(gaze);
  const reactionFrame = REACTIONS.indexOf(reaction ?? "blink");
  const squashScaleX = squash.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 1.1, 0.95, 1.03] });
  const squashScaleY = squash.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 0.86, 1.08, 0.97] });

  return (
    <View ref={rootRef}>
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
    </View>
  );
}
