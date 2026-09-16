import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Composer pill title; the host repeats it in a hover tooltip we hide on web. */
export const PILL_TITLE = "Choose mascot";
export const NAME_MAX_LENGTH = 16;

export const mascotSettings = defineSettings({
  id: "mascot",
  scope: "host",
  version: 1,
  schema: z.object({
    mascot: z.string().default("fox"),
    /** A pet name shown under the mascot; empty means none. */
    name: z.string().max(NAME_MAX_LENGTH).default(""),
    /** Free-dragged viewport position; null keeps the mascot perched on the composer. */
    position: z
      .object({ x: z.number(), y: z.number() })
      .nullable()
      .default(null),
  }),
});
