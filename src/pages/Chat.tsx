import {
  createEffect,
  createSignal,
  createMemo,
  onCleanup,
  Show,
} from "solid-js";
import { Auth } from "../lib/auth";
import { useNavigate } from "@solidjs/router";
import { client } from "../lib/opencode-client";
import { sessionStore, setSessionStore } from "../stores/session";
import {
  messageStore,
  setMessageStore,
  MessageWithParts,
} from "../stores/message";
import { MessageList } from "../components/MessageList";
import { PromptInput } from "../components/PromptInput";
import { SessionSidebar } from "../components/SessionSidebar";
import { MessageV2 } from "../types/opencode";

export default function Chat() {
  const navigate = useNavigate();
  const [sending, setSending] = createSignal(false);
  const [messagesRef, setMessagesRef] = createSignal<HTMLDivElement>();
  const [loadingMessages, setLoadingMessages] = createSignal(false);

  const handleLogout = () => {
    Auth.logout();
    navigate("/login", { replace: true });
  };

  const scrollToBottom = () => {
    const el = messagesRef();
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  // 加载指定会话的消息
  const loadSessionMessages = async (sessionId: string) => {
    console.log("[LoadMessages] Loading messages for session:", sessionId);
    setLoadingMessages(true);

    const messages = await client.getMessages(sessionId);
    console.log("[LoadMessages] Loaded messages:", messages);

    const messagesMap: Record<string, MessageWithParts> = {};

    for (const msg of messages) {
      // API 返回的格式是 { info: {...}, parts: [...] }
      const msgInfo = (msg as any).info || msg;
      const msgParts = (msg as any).parts || [];

      console.log(
        "[LoadMessages] Processing message:",
        msgInfo.id,
        "with",
        msgParts.length,
        "parts",
      );

      messagesMap[msgInfo.id] = {
        ...msgInfo,
        parts: msgParts,
      };
    }

    console.log("[LoadMessages] Final messages map:", messagesMap);
    setMessageStore("bySession", sessionId, messagesMap);
    setLoadingMessages(false);
    setTimeout(scrollToBottom, 100);
  };

  const initializeSession = async () => {
    console.log("[Init] Starting session initialization");
    setSessionStore({ loading: true });

    const sessions = await client.listSessions();
    console.log("[Init] Loaded sessions:", sessions);

    // 处理会话列表，将时间戳转换为 ISO 字符串
    const processedSessions = sessions.map((s) => ({
      id: s.id,
      title: s.title || "未命名会话",
      createdAt: new Date(s.time.created).toISOString(),
      updatedAt: new Date(s.time.updated).toISOString(),
    }));

    let currentSession = processedSessions[0];
    if (!currentSession) {
      console.log("[Init] No sessions found, creating new one");
      const newSession = await client.createSession("新会话");
      currentSession = {
        id: newSession.id,
        title: newSession.title || "新会话",
        createdAt: new Date(newSession.time.created).toISOString(),
        updatedAt: new Date(newSession.time.updated).toISOString(),
      };
      processedSessions.push(currentSession);
    }

    setSessionStore({
      list: processedSessions,
      current: currentSession.id,
      loading: false,
    });

    await loadSessionMessages(currentSession.id);
  };

  // 切换会话
  const handleSelectSession = async (sessionId: string) => {
    console.log("[SelectSession] Switching to session:", sessionId);
    setSessionStore("current", sessionId);

    // 如果该会话的消息还没加载过，则加载
    if (!messageStore.bySession[sessionId]) {
      await loadSessionMessages(sessionId);
    } else {
      setTimeout(scrollToBottom, 100);
    }
  };

  // 新建会话
  const handleNewSession = async () => {
    console.log("[NewSession] Creating new session");
    const newSession = await client.createSession("新会话");
    console.log("[NewSession] Created:", newSession);

    const processedSession = {
      id: newSession.id,
      title: newSession.title || "新会话",
      createdAt: new Date(newSession.time.created).toISOString(),
      updatedAt: new Date(newSession.time.updated).toISOString(),
    };

    setSessionStore("list", (list) => [processedSession, ...list]);
    setSessionStore("current", processedSession.id);

    // 初始化空消息
    setMessageStore("bySession", processedSession.id, {});
    setTimeout(scrollToBottom, 100);
  };

  // 删除会话
  const handleDeleteSession = async (sessionId: string) => {
    console.log("[DeleteSession] Deleting session:", sessionId);

    await client.deleteSession(sessionId);

    // 从列表中移除
    setSessionStore("list", (list) => list.filter((s) => s.id !== sessionId));

    // 如果删除的是当前会话，切换到第一个会话
    if (sessionStore.current === sessionId) {
      const remaining = sessionStore.list.filter((s) => s.id !== sessionId);
      if (remaining.length > 0) {
        await handleSelectSession(remaining[0].id);
      } else {
        // 没有会话了，创建一个新的
        await handleNewSession();
      }
    }
  };

  const handleSSEEvent = (event: { type: string; data: any }) => {
    console.log("[SSE] Event received:", event.type, event.data);

    const sessionId = sessionStore.current;
    if (!sessionId) {
      console.log("[SSE] No current sessionId, ignoring event");
      return;
    }

    if (event.type === "message.part.updated") {
      const part = event.data as MessageV2.Part;
      const messageId = part.messageID;

      console.log(
        "[SSE] Part update - messageID:",
        messageId,
        "partId:",
        part.id,
        "type:",
        part.type,
      );
      console.log(
        "[SSE] Part content:",
        part.type === "text" ? part.text?.slice(0, 100) : part,
      );

      setMessageStore("bySession", sessionId, messageId, (msg) => {
        console.log("[SSE] Current message in store:", msg);

        if (!msg) {
          const newMsg: MessageWithParts = {
            id: messageId,
            sessionID: sessionId,
            role: "assistant",
            time: {
              created: Date.now(),
            },
            parts: [part],
          };
          console.log("[SSE] Creating new message:", newMsg);
          return newMsg;
        }

        const existingIndex = msg.parts.findIndex((p) => p.id === part.id);
        if (existingIndex >= 0) {
          console.log("[SSE] Updating existing part at index:", existingIndex);
          return {
            ...msg,
            parts: msg.parts.map((p, i) => (i === existingIndex ? part : p)),
          };
        }

        console.log("[SSE] Adding new part to message");
        return {
          ...msg,
          parts: [...msg.parts, part],
        };
      });

      console.log(
        "[SSE] Store after update:",
        messageStore.bySession[sessionId],
      );
      setTimeout(scrollToBottom, 0);
    }

    if (event.type === "session.updated") {
      const updated = event.data;
      setSessionStore("list", (list) =>
        list.map((s) =>
          s.id === updated.id
            ? {
                id: updated.id,
                title: updated.title || "未命名会话",
                createdAt: new Date(updated.time.created).toISOString(),
                updatedAt: new Date(updated.time.updated).toISOString(),
              }
            : s,
        ),
      );
    }
  };

  const handleSendMessage = async (text: string) => {
    const sessionId = sessionStore.current;
    if (!sessionId || sending()) return;

    setSending(true);

    const tempMessageId = `temp-${Date.now()}`;
    const tempMessage: MessageWithParts = {
      id: tempMessageId,
      sessionID: sessionId,
      role: "user",
      time: {
        created: Date.now(),
      },
      parts: [
        {
          id: `part-${Date.now()}`,
          messageID: tempMessageId,
          sessionID: sessionId,
          type: "text",
          text,
          synthetic: false,
        },
      ],
    };

    setMessageStore("bySession", sessionId, tempMessageId, tempMessage);
    setTimeout(scrollToBottom, 0);

    await client.sendMessage(sessionId, text);
    setSending(false);
  };

  createEffect(() => {
    initializeSession();

    const cleanup = client.connectSSE(handleSSEEvent);
    onCleanup(cleanup);
  });

  const currentMessages = createMemo(() => {
    const sessionId = sessionStore.current;
    console.log("[currentMessages] sessionId:", sessionId);

    if (!sessionId) return [];

    const sessionMessages = messageStore.bySession[sessionId];
    console.log(
      "[currentMessages] sessionMessages from store:",
      sessionMessages,
    );

    if (!sessionMessages) return [];

    const sorted = Object.values(sessionMessages).sort(
      (a, b) => a.time.created - b.time.created,
    );

    console.log(
      "[currentMessages] Returning",
      sorted.length,
      "messages:",
      sorted,
    );
    return sorted;
  });

  return (
    <div class="flex h-screen bg-white dark:bg-zinc-900">
      {/* 会话侧边栏 */}
      <Show when={!sessionStore.loading}>
        <SessionSidebar
          sessions={sessionStore.list}
          currentSessionId={sessionStore.current}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
        />
      </Show>

      {/* 主聊天区域 */}
      <div class="flex-1 flex flex-col overflow-hidden">
        <header class="flex items-center justify-between px-6 py-4 border-b dark:border-zinc-800">
          <h1 class="text-xl font-bold text-gray-800 dark:text-white">
            OpenCode Remote
          </h1>
          <button
            onClick={handleLogout}
            class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            退出登录
          </button>
        </header>

        <main class="flex-1 flex flex-col overflow-hidden">
          <Show
            when={!sessionStore.loading && sessionStore.current}
            fallback={
              <div class="flex-1 flex items-center justify-center">
                <div class="text-gray-600 dark:text-gray-400">加载中...</div>
              </div>
            }
          >
            <Show
              when={!loadingMessages()}
              fallback={
                <div class="flex-1 flex items-center justify-center">
                  <div class="text-gray-600 dark:text-gray-400">
                    加载消息中...
                  </div>
                </div>
              }
            >
              <div ref={setMessagesRef} class="flex-1 overflow-y-auto px-6">
                <div class="max-w-4xl mx-auto">
                  <Show
                    when={currentMessages().length > 0}
                    fallback={
                      <div class="flex flex-col items-center justify-center h-full text-center">
                        <h2 class="text-2xl font-bold text-gray-800 dark:text-white mb-2">
                          开始对话
                        </h2>
                        <p class="text-gray-600 dark:text-gray-400">
                          在下方输入消息开始聊天
                        </p>
                      </div>
                    }
                  >
                    <MessageList messages={currentMessages()} />
                  </Show>
                </div>
              </div>

              <div class="border-t dark:border-zinc-800 p-4">
                <PromptInput onSend={handleSendMessage} disabled={sending()} />
              </div>
            </Show>
          </Show>
        </main>
      </div>
    </div>
  );
}
