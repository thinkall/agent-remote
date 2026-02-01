import { For, Show, createSignal, createResource, onMount } from "solid-js";
import { copilotCliAPI, CopilotCliSession } from "../lib/electron-api";
import { useI18n, formatMessage } from "../lib/i18n";
import { isElectron } from "../lib/platform";

export function CopilotCliHistory() {
  const { t, locale } = useI18n();
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [sessions, { refetch }] = createResource(async () => {
    if (!isElectron()) return [];
    return copilotCliAPI.listSessions();
  });

  // Refetch when expanded
  const toggleExpanded = () => {
    const newState = !isExpanded();
    setIsExpanded(newState);
    if (newState) {
      refetch();
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t().sidebar.justNow;
    if (diffMins < 60) return formatMessage(t().sidebar.minutesAgo, { count: diffMins });
    if (diffHours < 24) return formatMessage(t().sidebar.hoursAgo, { count: diffHours });
    if (diffDays < 7) return formatMessage(t().sidebar.daysAgo, { count: diffDays });

    return date.toLocaleDateString(locale() === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const getProjectName = (directory: string): string => {
    if (!directory) return "Unknown";
    const parts = directory.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || "Unknown";
  };

  // Only render in Electron environment
  if (!isElectron()) {
    return null;
  }

  return (
    <div class="border-t border-gray-200 dark:border-zinc-800 mt-2 pt-2">
      {/* Header */}
      <div
        class="group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-900 transition-colors"
        onClick={toggleExpanded}
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          {/* Expand/Collapse Arrow */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class={`text-gray-400 transition-transform flex-shrink-0 ${
              isExpanded() ? "rotate-90" : ""
            }`}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>

          {/* CLI Icon */}
          <div class="w-5 h-5 rounded flex items-center justify-center bg-gray-500 text-white text-xs font-medium flex-shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" x2="20" y1="19" y2="19" />
            </svg>
          </div>

          {/* Title */}
          <div class="min-w-0 flex-1">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate block">
              {t().sidebar.copilotCliHistory}
            </span>
            <span class="text-[10px] text-gray-400 dark:text-gray-500 truncate block">
              {t().sidebar.copilotCliHistoryDesc}
            </span>
          </div>
        </div>

        {/* Session count badge */}
        <Show when={sessions() && sessions()!.length > 0}>
          <span class="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-gray-300 rounded">
            {sessions()!.length}
          </span>
        </Show>
      </div>

      {/* Session List */}
      <Show when={isExpanded()}>
        <div class="ml-4 mt-1 max-h-64 overflow-y-auto">
          <Show
            when={!sessions.loading}
            fallback={
              <div class="px-3 py-2 text-xs text-gray-400">Loading...</div>
            }
          >
            <Show
              when={sessions() && sessions()!.length > 0}
              fallback={
                <div class="px-3 py-2 text-xs text-gray-400">
                  {t().sidebar.noCliSessions}
                </div>
              }
            >
              <For each={sessions()!.slice(0, 20)}>
                {(session) => (
                  <div
                    class="px-3 py-2 mb-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-900 transition-colors"
                    title={`${session.directory}\nID: ${session.id}`}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-gray-600 dark:text-gray-400 truncate">
                          {session.title}
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span class="text-[10px] text-gray-400 truncate">
                            {getProjectName(session.directory)}
                          </span>
                          <span class="text-[10px] text-gray-400 flex-shrink-0">
                            {formatDate(session.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
