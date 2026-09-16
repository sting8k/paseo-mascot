import type { PluginButtonRegistration } from "@getpaseo/plugin/client";

/** Button title, also what the host's tooltip would repeat on hover. */
export const PILL_TITLE = "Choose mascot";

// Pill registrations accumulate across agents; update() is a noop after removal.
const pills = new Set<PluginButtonRegistration>();

export function registerPill(reg: PluginButtonRegistration): void {
  pills.add(reg);
}

export function updatePillLabels(label: string): void {
  for (const reg of pills) reg.update({ label });
}
