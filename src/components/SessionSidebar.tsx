import { For, Show } from "solid-js";
import { SessionInfo } from "../stores/session";

interface SessionSidebarProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
}

export function SessionSidebar(props: SessionSidebarProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;

    return date.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div class="w-64 bg-gray-50 dark:bg-zinc-800 border-r dark:border-zinc-700 flex flex-col h-full">
      {/* 头部 */}
      <div class="p-4 border-b dark:border-zinc-700">
        <button
          onClick={props.onNewSession}
          class="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
        >
          + 新建会话
        </button>
      </div>

      {/* 会话列表 */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={props.sessions.length > 0}
          fallback={
            <div class="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              暂无会话
            </div>
          }
        >
          <For each={props.sessions}>
            {(session) => {
              const isActive = () => session.id === props.currentSessionId;

              return (
                <div
                  class={`group relative px-3 py-2 mx-2 my-1 rounded-lg cursor-pointer transition-colors ${
                    isActive()
                      ? "bg-blue-100 dark:bg-blue-900/30"
                      : "hover:bg-gray-200 dark:hover:bg-zinc-700"
                  }`}
                  onClick={() => props.onSelectSession(session.id)}
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                      <div
                        class={`text-sm font-medium truncate ${
                          isActive()
                            ? "text-blue-700 dark:text-blue-300"
                            : "text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {session.title || "未命名会话"}
                      </div>
                      <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatDate(session.updatedAt)}
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("确定要删除这个会话吗？")) {
                          props.onDeleteSession(session.id);
                        }
                      }}
                      class="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                      title="删除会话"
                    >
                      <svg
                        class="w-4 h-4 text-red-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      {/* 底部信息 */}
      <div class="p-4 border-t dark:border-zinc-700 text-xs text-gray-500 dark:text-gray-400">
        共 {props.sessions.length} 个会话
      </div>
    </div>
  );
}
