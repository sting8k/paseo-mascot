import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { MascotFaceIcon, MascotPickerContent } from "./client/mascot";
import { PILL_TITLE, registerPill } from "./client/pill-registry";

export default function contribute(client: PluginClientContext) {
  // Composer pills are per-agent registrations and the 0.8.0 client SDK has no
  // reactive agent directory, so register from a one-shot list and let the
  // Command Center item cover agents created later.
  const pills = new Map<string, PluginButtonRegistration>();
  let released = false;

  function addPill(workspaceId: string, agentId: string) {
    if (released || pills.has(agentId)) return;
    const registration = client.addComposerPill({
      id: "mascot",
      workspaceId,
      agentId,
      button: {
        title: PILL_TITLE,
        icon: MascotFaceIcon,
        label: "Mascot",
        behavior: { kind: "popover", Content: MascotPickerContent },
      },
    });
    pills.set(agentId, registration);
    registerPill(registration);
  }

  client.addCommandCenterItem({
    id: "composer-mascot",
    title: "Mascot: add a mascot to this composer",
    icon: "Cat",
    keywords: ["mascot", "cat", "pet", "fox"],
    context: "agent",
    onSelect(context) {
      addPill(context.workspace.id, context.agent.id);
    },
  });

  // Best effort: a pill in every existing composer.
  void client.paseo.agents.list().then((result) => {
    if (released) return;
    for (const entry of result.entries) {
      if (entry.agent.workspaceId) addPill(entry.agent.workspaceId, entry.agent.id);
    }
  });

  return () => {
    released = true;
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
