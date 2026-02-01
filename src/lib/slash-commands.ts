// Slash command definitions and handlers

export interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  // If true, command is handled locally without sending to backend
  local?: boolean;
  // If true, command requires an argument
  requiresArg?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Session management
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
    name: "new",
    description: "Create a new session",
    local: true,
  },
  {
    name: "resume",
    description: "Resume a previous session",
    local: false,
  },
  
  // Undo/Redo
  {
    name: "undo",
    description: "Revert the last change",
    local: false,
  },
  
  // Model management
  {
    name: "model",
    description: "Show or switch AI model",
    local: true,
    requiresArg: false,
  },
  
  // Directory/Context management
  {
    name: "cwd",
    description: "Show or change working directory",
    local: false,
  },
  {
    name: "add-dir",
    description: "Grant access to an additional directory",
    local: false,
    requiresArg: true,
  },
  {
    name: "list-dirs",
    description: "List all accessible directories",
    local: false,
  },
  
  // Session info
  {
    name: "usage",
    description: "Display session statistics and token usage",
    local: false,
  },
  {
    name: "session",
    description: "Show detailed session metrics",
    local: false,
  },
  
  // Help
  {
    name: "help",
    description: "Show available commands",
    local: true,
  },
  
  // Exit
  {
    name: "exit",
    description: "End the current session",
    aliases: ["quit"],
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
