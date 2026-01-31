/**
 * Copilot ACP Bridge Server
 * 
 * This server acts as a bridge between the HTTP REST API expected by the frontend
 * and the ACP (Agent Client Protocol) used by GitHub Copilot CLI.
 * 
 * It translates:
 * - REST API calls → ACP JSON-RPC requests
 * - ACP notifications → SSE events
 */

import { spawn, ChildProcess } from "child_process";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { createConnection, Socket } from "net";
import { EventEmitter } from "events";
import * as ACP from "../src/types/copilot-acp";

// ============================================================================
// Configuration
// ============================================================================

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || "4096");
const COPILOT_ACP_PORT = parseInt(process.env.COPILOT_ACP_PORT || "4097");
const COPILOT_CWD = process.env.COPILOT_CWD || process.cwd();

// ============================================================================
// Types
// ============================================================================

interface SessionInfo {
  id: string;
  cwd: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messages: MessageInfo[];
}

interface MessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: {
    created: number;
    completed?: number;
  };
  parts: MessagePart[];
  modelID?: string;
  providerID?: string;
}

interface MessagePart {
  id: string;
  messageID: string;
  sessionID: string;
  type: string;
  [key: string]: unknown;
}

interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: {
    messageID: string;
    callID: string;
  };
  // ACP-specific
  acpParams?: ACP.RequestPermissionParams;
}

// ============================================================================
// ACP Client
// ============================================================================

class ACPClient extends EventEmitter {
  private socket: Socket | null = null;
  private buffer: string = "";
  private requestId: number = 0;
  private pendingRequests: Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private initialized: boolean = false;

  constructor(private port: number) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection({ port: this.port }, () => {
        console.log(`[ACP] Connected to Copilot ACP server on port ${this.port}`);
        resolve();
      });

      this.socket.on("data", (data) => this.handleData(data));
      this.socket.on("error", (err) => {
        console.error("[ACP] Socket error:", err);
        reject(err);
      });
      this.socket.on("close", () => {
        console.log("[ACP] Connection closed");
        this.socket = null;
      });
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();
    
    // Process NDJSON (newline-delimited JSON)
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const message = JSON.parse(line) as ACP.JsonRpcMessage;
        this.handleMessage(message);
      } catch (e) {
        console.error("[ACP] Failed to parse message:", line, e);
      }
    }
  }

  private handleMessage(message: ACP.JsonRpcMessage): void {
    // Response to a request we sent
    if ("id" in message && message.id !== undefined && !("method" in message)) {
      const response = message as ACP.JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Request from server (e.g., permission request)
    if ("method" in message && "id" in message && message.id !== undefined) {
      const request = message as ACP.JsonRpcRequest;
      this.emit("request", request);
      return;
    }

    // Notification from server
    if ("method" in message && !("id" in message)) {
      const notification = message as ACP.JsonRpcNotification;
      this.emit("notification", notification);
      return;
    }
  }

  async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.socket) {
      throw new Error("Not connected to ACP server");
    }

    const id = ++this.requestId;
    const request: ACP.JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (r: unknown) => void, reject });
      this.socket!.write(JSON.stringify(request) + "\n");
    });
  }

  sendResponse(id: number | string, result?: unknown, error?: ACP.JsonRpcError): void {
    if (!this.socket) return;

    const response: ACP.JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result }),
    };
    this.socket.write(JSON.stringify(response) + "\n");
  }

  async initialize(): Promise<ACP.InitializeResult> {
    if (this.initialized) {
      return { protocolVersion: ACP.PROTOCOL_VERSION, agentCapabilities: {} };
    }

    const result = await this.sendRequest<ACP.InitializeResult>(
      ACP.ACP_METHODS.INITIALIZE,
      {
        protocolVersion: ACP.PROTOCOL_VERSION,
        clientCapabilities: {},
      } as ACP.InitializeParams
    );
    this.initialized = true;
    return result;
  }

  async newSession(cwd: string): Promise<ACP.NewSessionResult> {
    return this.sendRequest<ACP.NewSessionResult>(
      ACP.ACP_METHODS.SESSION_NEW,
      { cwd, mcpServers: [] } as ACP.NewSessionParams
    );
  }

  async prompt(sessionId: string, prompt: ACP.ContentBlock[]): Promise<ACP.PromptResult> {
    return this.sendRequest<ACP.PromptResult>(
      ACP.ACP_METHODS.SESSION_PROMPT,
      { sessionId, prompt } as ACP.PromptParams
    );
  }

  async cancel(sessionId: string): Promise<void> {
    // cancel is a notification, not a request
    if (!this.socket) return;
    const notification: ACP.JsonRpcNotification = {
      jsonrpc: "2.0",
      method: ACP.ACP_METHODS.SESSION_CANCEL,
      params: { sessionId } as ACP.CancelParams,
    };
    this.socket.write(JSON.stringify(notification) + "\n");
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

// ============================================================================
// Bridge Server State
// ============================================================================

class BridgeState {
  sessions: Map<string, SessionInfo> = new Map();
  pendingPermissions: Map<string, PermissionRequest> = new Map();
  sseClients: Set<ServerResponse> = new Set();
  currentMessageId: string | null = null;
  messageIdCounter: number = 0;
  partIdCounter: number = 0;
  permissionIdCounter: number = 0;
  toolCallToPermission: Map<string, string> = new Map(); // toolCallId -> permissionId

  generateMessageId(): string {
    return `msg-${Date.now()}-${++this.messageIdCounter}`;
  }

  generatePartId(): string {
    return `part-${Date.now()}-${++this.partIdCounter}`;
  }

  generatePermissionId(): string {
    return `perm-${Date.now()}-${++this.permissionIdCounter}`;
  }
}

// ============================================================================
// Bridge Server
// ============================================================================

class CopilotBridgeServer {
  private acp: ACPClient;
  private state: BridgeState;
  private copilotProcess: ChildProcess | null = null;

  constructor() {
    this.acp = new ACPClient(COPILOT_ACP_PORT);
    this.state = new BridgeState();
  }

  async start(): Promise<void> {
    // Start Copilot ACP server
    await this.startCopilotACP();

    // Wait for Copilot to be ready
    await this.waitForCopilot();

    // Connect to ACP
    await this.acp.connect();
    await this.acp.initialize();

    // Set up ACP event handlers
    this.setupACPHandlers();

    // Start HTTP server
    this.startHTTPServer();

    console.log(`[Bridge] Server running on port ${BRIDGE_PORT}`);
  }

  private async startCopilotACP(): Promise<void> {
    console.log("[Bridge] Starting Copilot ACP server...");

    const isWindows = process.platform === "win32";
    this.copilotProcess = spawn(
      "copilot",
      ["--acp", "--port", COPILOT_ACP_PORT.toString(), "--allow-all"],
      {
        stdio: ["pipe", "pipe", "inherit"],
        shell: isWindows,
        cwd: COPILOT_CWD,
      }
    );

    this.copilotProcess.on("error", (err) => {
      console.error("[Bridge] Failed to start Copilot:", err);
      process.exit(1);
    });

    this.copilotProcess.on("exit", (code) => {
      console.log(`[Bridge] Copilot process exited with code ${code}`);
    });
  }

  private async waitForCopilot(): Promise<void> {
    const maxAttempts = 30;
    const delay = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection({ port: COPILOT_ACP_PORT }, () => {
            socket.end();
            resolve();
          });
          socket.on("error", reject);
        });
        console.log("[Bridge] Copilot ACP server is ready");
        return;
      } catch {
        console.log(`[Bridge] Waiting for Copilot ACP server... (${i + 1}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error("Copilot ACP server did not start in time");
  }

  private setupACPHandlers(): void {
    // Handle ACP notifications (session updates)
    this.acp.on("notification", (notification: ACP.JsonRpcNotification) => {
      if (notification.method === ACP.ACP_METHODS.SESSION_UPDATE) {
        this.handleSessionUpdate(notification.params as ACP.SessionUpdateParams);
      }
    });

    // Handle ACP requests (permission requests)
    this.acp.on("request", (request: ACP.JsonRpcRequest) => {
      if (request.method === ACP.ACP_METHODS.REQUEST_PERMISSION) {
        this.handlePermissionRequest(request);
      }
    });
  }

  private handleSessionUpdate(params: ACP.SessionUpdateParams): void {
    const { sessionId, update } = params;
    const session = this.state.sessions.get(sessionId);
    if (!session) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        // Create or update assistant message
        let message = session.messages.find(
          (m) => m.id === this.state.currentMessageId && m.role === "assistant"
        );

        if (!message) {
          const msgId = this.state.generateMessageId();
          this.state.currentMessageId = msgId;
          message = {
            id: msgId,
            sessionID: sessionId,
            role: "assistant",
            time: { created: Date.now() },
            parts: [],
            modelID: "copilot",
            providerID: "github",
          };
          session.messages.push(message);

          // Emit message.updated for new message
          this.emitSSE("message.updated", {
            info: this.convertMessageToOpenCode(message),
          });
        }

        // Add text part
        if (update.content.type === "text") {
          const existingTextPart = message.parts.find((p) => p.type === "text") as {
            id: string;
            messageID: string;
            sessionID: string;
            type: "text";
            text: string;
          } | undefined;

          if (existingTextPart) {
            existingTextPart.text += update.content.text;
            this.emitSSE("message.part.updated", {
              part: existingTextPart,
            });
          } else {
            const part = {
              id: this.state.generatePartId(),
              messageID: message.id,
              sessionID: sessionId,
              type: "text" as const,
              text: update.content.text,
            };
            message.parts.push(part);
            this.emitSSE("message.part.updated", { part });
          }
        }

        session.updatedAt = Date.now();
        break;
      }

      case "tool_call": {
        const message = session.messages.find(
          (m) => m.id === this.state.currentMessageId && m.role === "assistant"
        );
        if (!message) break;

        const toolPart = {
          id: this.state.generatePartId(),
          messageID: message.id,
          sessionID: sessionId,
          type: "tool" as const,
          callID: update.toolCallId,
          tool: update.title || "tool",
          state: {
            status: this.mapToolStatus(update.status),
            ...(update.status !== "pending" && {
              input: {},
              time: { start: Date.now() },
            }),
          },
        };
        message.parts.push(toolPart);
        this.emitSSE("message.part.updated", { part: toolPart });
        break;
      }

      case "tool_call_update": {
        const message = session.messages.find(
          (m) => m.id === this.state.currentMessageId && m.role === "assistant"
        );
        if (!message) break;

        const toolPart = message.parts.find(
          (p) => p.type === "tool" && (p as any).callID === update.toolCallId
        );
        if (!toolPart) break;

        const now = Date.now();
        const startTime = (toolPart as any).state?.time?.start || now;

        (toolPart as any).state = {
          status: this.mapToolStatus(update.status),
          input: (toolPart as any).state?.input || {},
          ...(update.content?.[0]?.content.type === "text" && {
            output: (update.content[0].content as ACP.TextContent).text,
          }),
          time: {
            start: startTime,
            ...(update.status === "completed" || update.status === "errored" ? {
              end: now,
              duration: now - startTime,
            } : {}),
          },
        };

        this.emitSSE("message.part.updated", { part: toolPart });
        break;
      }

      case "state": {
        // State updates (idle/working) - we can use this for UI indicators
        break;
      }

      case "plan": {
        // Plan updates - could be rendered as a special message part
        break;
      }
    }
  }

  private mapToolStatus(
    status: ACP.ToolCallStatus
  ): "pending" | "running" | "completed" | "error" {
    switch (status) {
      case "pending":
        return "pending";
      case "in_progress":
        return "running";
      case "completed":
        return "completed";
      case "errored":
      case "cancelled":
        return "error";
      default:
        return "pending";
    }
  }

  private handlePermissionRequest(request: ACP.JsonRpcRequest): void {
    const params = request.params as ACP.RequestPermissionParams;
    const permissionId = this.state.generatePermissionId();

    // Store mapping from toolCallId to permissionId
    if (params.toolCallId) {
      this.state.toolCallToPermission.set(params.toolCallId, permissionId);
    }

    const permissionReq: PermissionRequest = {
      id: permissionId,
      sessionID: params.sessionId,
      permission: params.title,
      patterns: [],
      metadata: { description: params.description },
      always: params.options.filter((o) => o.id.includes("always")).map((o) => o.id),
      tool: params.toolCallId
        ? {
            messageID: this.state.currentMessageId || "",
            callID: params.toolCallId,
          }
        : undefined,
      acpParams: params,
    };

    this.state.pendingPermissions.set(permissionId, permissionReq);

    // Emit SSE event for permission
    this.emitSSE("permission.asked", {
      id: permissionId,
      sessionID: params.sessionId,
      permission: params.title,
      patterns: [],
      metadata: { description: params.description, options: params.options },
      always: permissionReq.always,
      tool: permissionReq.tool,
    });

    // Store the request ID to respond later
    (permissionReq as any)._acpRequestId = request.id;
  }

  private emitSSE(type: string, properties: Record<string, unknown>): void {
    const event = {
      payload: {
        type,
        properties,
      },
    };
    const data = `data: ${JSON.stringify(event)}\n\n`;

    console.log(`[SSE] Emitting ${type}:`, JSON.stringify(properties).slice(0, 200));

    for (const client of this.state.sseClients) {
      client.write(data);
    }
  }

  private startHTTPServer(): void {
    const server = createServer((req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-opencode-directory");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      this.handleRequest(req, res);
    });

    server.listen(BRIDGE_PORT, "0.0.0.0", () => {
      console.log(`[Bridge] HTTP server listening on port ${BRIDGE_PORT}`);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || "GET";

    // Get directory from header
    const directory = req.headers["x-opencode-directory"] as string || COPILOT_CWD;

    try {
      // Route requests
      if (path === "/global/event" && method === "GET") {
        this.handleSSE(req, res);
      } else if (path === "/session" && method === "GET") {
        this.handleListSessions(res, directory);
      } else if (path === "/session" && method === "POST") {
        await this.handleCreateSession(req, res, directory);
      } else if (path.match(/^\/session\/[^/]+$/) && method === "GET") {
        const sessionId = path.split("/")[2];
        this.handleGetSession(res, sessionId);
      } else if (path.match(/^\/session\/[^/]+$/) && method === "DELETE") {
        const sessionId = path.split("/")[2];
        this.handleDeleteSession(res, sessionId);
      } else if (path.match(/^\/session\/[^/]+$/) && method === "PATCH") {
        const sessionId = path.split("/")[2];
        await this.handleUpdateSession(req, res, sessionId);
      } else if (path.match(/^\/session\/[^/]+\/message$/) && method === "GET") {
        const sessionId = path.split("/")[2];
        this.handleGetMessages(res, sessionId);
      } else if (path.match(/^\/session\/[^/]+\/message$/) && method === "POST") {
        const sessionId = path.split("/")[2];
        await this.handleSendMessage(req, res, sessionId);
      } else if (path.match(/^\/session\/[^/]+\/message\/[^/]+\/part$/) && method === "GET") {
        const parts = path.split("/");
        const sessionId = parts[2];
        const messageId = parts[4];
        this.handleGetParts(res, sessionId, messageId);
      } else if (path.match(/^\/permission\/[^/]+\/reply$/) && method === "POST") {
        const permissionId = path.split("/")[2];
        await this.handlePermissionReply(req, res, permissionId);
      } else if (path === "/permission" && method === "GET") {
        this.handleListPermissions(res);
      } else if (path === "/provider" && method === "GET") {
        this.handleGetProviders(res);
      } else if (path === "/agent" && method === "GET") {
        this.handleGetAgents(res);
      } else if (path === "/project" && method === "GET") {
        this.handleListProjects(res, directory);
      } else if (path === "/project/current" && method === "GET") {
        this.handleGetCurrentProject(res, directory);
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    } catch (error) {
      console.error("[Bridge] Request error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  }

  private handleSSE(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    this.state.sseClients.add(res);

    req.on("close", () => {
      this.state.sseClients.delete(res);
    });

    // Send initial ping
    res.write("data: {}\n\n");
  }

  private handleListSessions(res: ServerResponse, directory: string): void {
    const sessions = Array.from(this.state.sessions.values())
      .filter((s) => s.cwd === directory)
      .map((s) => this.convertSessionToOpenCode(s));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sessions));
  }

  private async handleCreateSession(
    req: IncomingMessage,
    res: ServerResponse,
    directory: string
  ): Promise<void> {
    const body = await this.readBody(req);
    const { title } = body as { title?: string };

    // Create session via ACP
    const result = await this.acp.newSession(directory);

    const session: SessionInfo = {
      id: result.sessionId,
      cwd: directory,
      title: title || `Session ${new Date().toISOString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    this.state.sessions.set(session.id, session);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.convertSessionToOpenCode(session)));
  }

  private handleGetSession(res: ServerResponse, sessionId: string): void {
    const session = this.state.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.convertSessionToOpenCode(session)));
  }

  private handleDeleteSession(res: ServerResponse, sessionId: string): void {
    this.state.sessions.delete(sessionId);
    res.writeHead(204);
    res.end();
  }

  private async handleUpdateSession(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string
  ): Promise<void> {
    const session = this.state.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const body = await this.readBody(req);
    const { title } = body as { title?: string };

    if (title) {
      session.title = title;
      session.updatedAt = Date.now();
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.convertSessionToOpenCode(session)));
  }

  private handleGetMessages(res: ServerResponse, sessionId: string): void {
    const session = this.state.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const messages = session.messages.map((m) => this.convertMessageToOpenCode(m));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messages));
  }

  private async handleSendMessage(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string
  ): Promise<void> {
    const session = this.state.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const body = await this.readBody(req);
    const { parts } = body as { parts: Array<{ type: string; text?: string }> };

    // Extract text from parts
    const textPart = parts.find((p) => p.type === "text");
    const text = textPart?.text || "";

    // Create user message
    const userMessage: MessageInfo = {
      id: this.state.generateMessageId(),
      sessionID: sessionId,
      role: "user",
      time: { created: Date.now(), completed: Date.now() },
      parts: [
        {
          id: this.state.generatePartId(),
          messageID: "",
          sessionID: sessionId,
          type: "text",
          text,
        },
      ],
    };
    userMessage.parts[0].messageID = userMessage.id;
    session.messages.push(userMessage);

    // Emit user message info
    this.emitSSE("message.updated", {
      info: this.convertMessageToOpenCode(userMessage),
    });

    // Also emit user message part (frontend may need this for rendering)
    this.emitSSE("message.part.updated", {
      part: userMessage.parts[0],
    });

    // Send to Copilot (don't await - let it stream)
    this.acp
      .prompt(sessionId, [{ type: "text", text }])
      .then((result) => {
        // Prompt completed
        const assistantMessage = session.messages.find(
          (m) => m.id === this.state.currentMessageId && m.role === "assistant"
        );
        if (assistantMessage) {
          assistantMessage.time.completed = Date.now();
          this.emitSSE("message.updated", {
            info: this.convertMessageToOpenCode(assistantMessage),
          });
        }
        this.state.currentMessageId = null;
      })
      .catch((err) => {
        console.error("[Bridge] Prompt error:", err);
      });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  }

  private handleGetParts(
    res: ServerResponse,
    sessionId: string,
    messageId: string
  ): void {
    const session = this.state.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const message = session.messages.find((m) => m.id === messageId);
    if (!message) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Message not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(message.parts));
  }

  private async handlePermissionReply(
    req: IncomingMessage,
    res: ServerResponse,
    permissionId: string
  ): Promise<void> {
    const permission = this.state.pendingPermissions.get(permissionId);
    if (!permission) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Permission not found" }));
      return;
    }

    const body = await this.readBody(req);
    const { reply } = body as { reply: "once" | "always" | "reject" };

    // Map OpenCode reply to ACP outcome
    let outcome: ACP.PermissionOutcome;
    if (reply === "reject") {
      outcome = { outcome: "cancelled" };
    } else {
      // Find the appropriate option ID
      const options = permission.acpParams?.options || [];
      const selectedOption =
        reply === "always"
          ? options.find((o) => o.id.includes("always"))
          : options.find((o) => o.id.includes("once") || !o.id.includes("always"));
      outcome = {
        outcome: "selected",
        optionId: selectedOption?.id || "allow_once",
      };
    }

    // Send response to ACP
    const acpRequestId = (permission as any)._acpRequestId;
    if (acpRequestId) {
      this.acp.sendResponse(acpRequestId, { outcome });
    }

    this.state.pendingPermissions.delete(permissionId);

    // Emit SSE event
    this.emitSSE("permission.replied", {
      id: permissionId,
      sessionID: permission.sessionID,
      reply,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(true));
  }

  private handleListPermissions(res: ServerResponse): void {
    const permissions = Array.from(this.state.pendingPermissions.values()).map((p) => ({
      id: p.id,
      sessionID: p.sessionID,
      permission: p.permission,
      patterns: p.patterns,
      metadata: p.metadata,
      always: p.always,
      tool: p.tool,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(permissions));
  }

  private handleGetProviders(res: ServerResponse): void {
    // Return Copilot models in OpenCode format
    const models = [
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "claude-opus-4.5",
      "claude-sonnet-4",
      "gemini-3-pro-preview",
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex",
      "gpt-5.1",
      "gpt-5",
      "gpt-5.1-codex-mini",
      "gpt-5-mini",
      "gpt-4.1",
    ];

    const modelsMap: Record<string, any> = {};
    for (const model of models) {
      modelsMap[model] = {
        id: model,
        providerID: "github-copilot",
        name: model,
        family: model.split("-")[0],
        status: "available",
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 128000, output: 16000 },
        capabilities: {
          temperature: true,
          reasoning: model.includes("opus"),
          attachment: true,
          toolcall: true,
        },
        release_date: "2025-01-01",
      };
    }

    const response = {
      all: [
        {
          id: "github-copilot",
          source: "github",
          name: "GitHub Copilot",
          env: [],
          options: {},
          models: modelsMap,
        },
      ],
      connected: ["github-copilot"],
      default: { "github-copilot": "claude-sonnet-4.5" },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private handleGetAgents(res: ServerResponse): void {
    const agents = [
      { name: "build", options: {}, permission: [], native: true },
      { name: "plan", options: {}, permission: [], native: true },
    ];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(agents));
  }

  private handleListProjects(res: ServerResponse, directory: string): void {
    const projects = [
      {
        id: "copilot-project",
        worktree: directory,
        vcs: "git",
        name: directory.split(/[/\\]/).pop() || "Project",
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
        sandboxes: [],
      },
    ];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(projects));
  }

  private handleGetCurrentProject(res: ServerResponse, directory: string): void {
    const project = {
      id: "copilot-project",
      worktree: directory,
      vcs: "git",
      name: directory.split(/[/\\]/).pop() || "Project",
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      sandboxes: [],
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(project));
  }

  private convertSessionToOpenCode(session: SessionInfo) {
    return {
      id: session.id,
      directory: session.cwd,
      title: session.title,
      time: {
        created: session.createdAt,
        updated: session.updatedAt,
      },
    };
  }

  private convertMessageToOpenCode(message: MessageInfo) {
    return {
      id: message.id,
      sessionID: message.sessionID,
      role: message.role,
      time: message.time,
      parts: message.parts,
      modelID: message.modelID || "copilot",
      providerID: message.providerID || "github",
    };
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  stop(): void {
    if (this.copilotProcess) {
      this.copilotProcess.kill();
    }
    this.acp.disconnect();
  }
}

// ============================================================================
// Main
// ============================================================================

const bridge = new CopilotBridgeServer();

bridge.start().catch((err) => {
  console.error("[Bridge] Failed to start:", err);
  process.exit(1);
});

// Handle shutdown
process.on("SIGINT", () => {
  console.log("\n[Bridge] Shutting down...");
  bridge.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Bridge] Shutting down...");
  bridge.stop();
  process.exit(0);
});
