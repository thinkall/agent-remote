import { MessageV2, Session } from "../types/opencode";

export class OpenCodeClient {
  private baseUrl: string;

  constructor(baseUrl: string = "/opencode-api") {
    this.baseUrl = baseUrl;
  }

  // 会话管理
  async listSessions() {
    return this.request<Session.Info[]>("/session");
  }

  async createSession(title?: string) {
    return this.request<Session.Info>("/session", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  }

  async deleteSession(id: string) {
    return this.request(`/session/${id}`, { method: "DELETE" });
  }

  async getSession(id: string) {
    return this.request<Session.Info>(`/session/${id}`);
  }

  // 消息操作
  async sendMessage(sessionId: string, text: string) {
    return this.request(`/session/${sessionId}/message`, {
      method: "POST",
      body: JSON.stringify({
        parts: [
          {
            type: "text",
            text: text,
          },
        ],
      }),
    });
  }

  async getMessages(sessionId: string) {
    return this.request<MessageV2.Info[]>(`/session/${sessionId}/message`);
  }

  async getMessageParts(sessionId: string, messageId: string) {
    return this.request<MessageV2.Part[]>(
      `/session/${sessionId}/message/${messageId}/part`,
    );
  }

  // SSE 连接
  connectSSE(
    onEvent: (event: { type: string; data: any }) => void,
  ): () => void {
    const eventSource = new EventSource(`${this.baseUrl}/global/event`);

    console.log("[SSE Client] Connected to:", `${this.baseUrl}/global/event`);

    eventSource.onopen = () => {
      console.log("[SSE Client] Connection opened");
    };

    eventSource.onerror = (error) => {
      console.error("[SSE Client] Error:", error);
    };

    eventSource.onmessage = (event) => {
      console.log("[SSE Client] Raw message event:", event.data);

      try {
        const parsed = JSON.parse(event.data);
        console.log("[SSE Client] Parsed data:", parsed);

        // OpenCode 的 SSE 格式：{ payload: { type: "...", properties: {...} } }
        if (parsed.payload) {
          const eventType = parsed.payload.type;
          const properties = parsed.payload.properties;

          console.log("[SSE Client] Event type:", eventType);
          console.log("[SSE Client] Properties:", properties);

          // 根据不同的事件类型提取数据
          if (eventType === "message.part.updated" && properties.part) {
            onEvent({ type: "message.part.updated", data: properties.part });
          } else if (eventType === "session.updated" && properties.info) {
            onEvent({ type: "session.updated", data: properties.info });
          } else if (eventType === "session.created" && properties.info) {
            onEvent({ type: "session.created", data: properties.info });
          } else if (eventType === "message.updated" && properties.info) {
            onEvent({ type: "message.updated", data: properties.info });
          } else {
            console.log("[SSE Client] Unhandled event type:", eventType);
          }
        }
      } catch (e) {
        console.error(
          "[SSE Client] Failed to parse SSE message",
          e,
          event.data,
        );
      }
    };

    return () => {
      console.log("[SSE Client] Closing connection");
      eventSource.close();
    };
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    // Some endpoints might return empty body
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }
}

export const client = new OpenCodeClient();
