// Slash command definitions and handlers

export interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  // If true, command is handled locally without sending to backend
  local?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "clear",
    description: "Clear the current conversation",
    local: true,
  },
  {
    name: "compact",
    description: "Summarize and compact the conversation history",
    local: false,
  },
  {
    name: "help",
    description: "Show available commands",
    local: true,
  },
  {
    name: "new",
    description: "Create a new session",
    local: true,
  },
];

export function parseSlashCommand(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: "" };
  }
  
  return {
    command: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

export function findMatchingCommands(prefix: string): SlashCommand[] {
  const lowerPrefix = prefix.toLowerCase();
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(lowerPrefix) ||
      cmd.aliases?.some((alias) => alias.startsWith(lowerPrefix))
  );
}

export function getCommand(name: string): SlashCommand | undefined {
  const lowerName = name.toLowerCase();
  return SLASH_COMMANDS.find(
    (cmd) => cmd.name === lowerName || cmd.aliases?.includes(lowerName)
  );
}
