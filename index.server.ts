import type { PluginServerContext } from "@getpaseo/plugin/server";
import { mascotSettings } from "./shared/mascot-settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(mascotSettings);
  return () => {};
}
