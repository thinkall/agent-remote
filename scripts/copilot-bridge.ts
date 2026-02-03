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
import { readdir, readFile, stat, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import * as ACP from "../src/types/copilot-acp";

// ============================================================================
// Configuration
// ============================================================================

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || "4096");
const COPILOT_ACP_PORT = parseInt(process.env.COPILOT_ACP_PORT || "4097");
const COPILOT_CWD = process.env.COPILOT_CWD || process.cwd();
const COPILOT_SESSION_STATE_DIR = join(homedir(), ".copilot", "session-state");
const COPILOT_CONFIG_DIR = join(homedir(), ".copilot");
const COPILOT_CONFIG_FILE = join(COPILOT_CONFIG_DIR, "config.json");
const COPILOT_MCP_CONFIG_FILE = join(COPILOT_CONFIG_DIR, "mcp-config.json");

// ============================================================================
// User Configuration Types
// ============================================================================

interface CopilotConfig {
  model?: string;
  trusted_folders?: string[];
  allowed_urls?: string[];
  render_markdown?: boolean;
  theme?: string;
}

interface McpServerConfig {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

// Global loaded configs
let userConfig: CopilotConfig = {};
let mcpConfig: McpConfig = {};
let loadedMcpServers: ACP.McpServer[] = [];

// ============================================================================
// Types
// ============================================================================

interface SessionInfo {
  id: string;
  cwd: string;
  projectID?: string;
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
  private agentCapabilities: ACP.AgentCapabilities = {};

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
      return { protocolVersion: ACP.PROTOCOL_VERSION, agentCapabilities: this.agentCapabilities };
    }

    const result = await this.sendRequest<ACP.InitializeResult>(
      ACP.ACP_METHODS.INITIALIZE,
      {
        protocolVersion: ACP.PROTOCOL_VERSION,
        clientCapabilities: {},
      } as ACP.InitializeParams
    );
    this.initialized = true;
    this.agentCapabilities = result.agentCapabilities || {};
    return result;
  }

  supportsLoadSession(): boolean {
    return this.agentCapabilities.loadSession === true;
  }

  async newSession(cwd: string, mcpServers?: ACP.McpServer[]): Promise<ACP.NewSessionResult> {
    return this.sendRequest<ACP.NewSessionResult>(
      ACP.ACP_METHODS.SESSION_NEW,
      { cwd, mcpServers: mcpServers || [] } as ACP.NewSessionParams
    );
  }

  async loadSession(sessionId: string, cwd: string, mcpServers?: ACP.McpServer[]): Promise<void> {
    return this.sendRequest<void>(
      ACP.ACP_METHODS.SESSION_LOAD,
      { sessionId, cwd, mcpServers: mcpServers || [] } as ACP.LoadSessionParams
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
  loadedAcpSessions: Set<string> = new Set(); // Sessions that have been loaded in ACP

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

// Helper to generate a consistent projectID from a directory path
function generateProjectID(directory: string): string {
  // Normalize the path and create a simple hash-like ID
  const normalized = directory.replace(/\\/g, "/").toLowerCase();
  // Use a simple string hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `proj-${Math.abs(hash).toString(16)}`;
}

class CopilotBridgeServer {
  private acp: ACPClient;
  private state: BridgeState;
  private copilotProcess: ChildProcess | null = null;

  constructor() {
    this.acp = new ACPClient(COPILOT_ACP_PORT);
    this.state = new BridgeState();
  }

  async start(): Promise<void> {
    // Load user configuration files
    await this.loadConfigs();

    // Load historical sessions from disk
    await this.loadHistoricalSessions();

    // Start Copilot ACP server
    await this.startCopilotACP();

    // Wait for Copilot to be ready
    await this.waitForCopilot();

    // Connect to ACP
    await this.acp.connect();
    const initResult = await this.acp.initialize();
    console.log(`[Bridge] ACP initialized, capabilities: loadSession=${initResult.agentCapabilities?.loadSession || false}, setMode=${initResult.agentCapabilities?.setMode || false}`);

    // Set up ACP event handlers
    this.setupACPHandlers();

    // Start HTTP server
    this.startHTTPServer();

    console.log(`[Bridge] Server running on port ${BRIDGE_PORT}`);
  }

  /**
   * Load user configuration from ~/.copilot/config.json and ~/.copilot/mcp-config.json
   */
  private async loadConfigs(): Promise<void> {
    // Load user config
    try {
      const configContent = await readFile(COPILOT_CONFIG_FILE, "utf-8");
      userConfig = JSON.parse(configContent);
      console.log(`[Bridge] Loaded user config: model=${userConfig.model}, trusted_folders=${userConfig.trusted_folders?.length || 0}`);
    } catch (err) {
      console.log("[Bridge] No user config found, using defaults");
    }

    // Load MCP config
    try {
      const mcpContent = await readFile(COPILOT_MCP_CONFIG_FILE, "utf-8");
      mcpConfig = JSON.parse(mcpContent);
      
      // Convert MCP servers to ACP format
      if (mcpConfig.mcpServers) {
        // Note: We don't pass MCP servers via ACP session/new because 
        // Copilot CLI reads them directly from ~/.copilot/mcp-config.json.
        // Passing them via ACP can cause "Internal error" if the server fails to start.
        // We just log what's configured for debugging purposes.
        const serverNames = Object.keys(mcpConfig.mcpServers);
        console.log(`[Bridge] MCP servers configured in mcp-config.json: ${serverNames.join(", ")}`);
        console.log(`[Bridge] Copilot CLI will load these servers directly from config file`);
        loadedMcpServers = []; // Let Copilot load them directly
      }
    } catch (err) {
      console.log("[Bridge] No MCP config found");
    }
  }

  /**
   * Load historical sessions from ~/.copilot/session-state
   */
  private async loadHistoricalSessions(): Promise<void> {
    console.log(`[Bridge] Loading historical sessions from ${COPILOT_SESSION_STATE_DIR}...`);
    
    try {
      const entries = await readdir(COPILOT_SESSION_STATE_DIR, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const sessionId = entry.name;
        const sessionDir = join(COPILOT_SESSION_STATE_DIR, sessionId);
        const workspaceFile = join(sessionDir, "workspace.yaml");
        
        try {
          const content = await readFile(workspaceFile, "utf-8");
          const sessionData = this.parseWorkspaceYaml(content);
          
          if (sessionData) {
            const cwd = sessionData.cwd || sessionData.git_root || COPILOT_CWD;
            // Use summary as title if available, otherwise use a readable format
            let title = sessionData.summary;
            if (!title) {
              // Fall back to date-based title
              const createdDate = sessionData.created_at 
                ? new Date(sessionData.created_at).toLocaleString()
                : new Date().toLocaleString();
              title = `Session - ${createdDate}`;
            }
            
            const session: SessionInfo = {
              id: sessionId,
              cwd,
              projectID: generateProjectID(cwd),
              title,
              createdAt: sessionData.created_at ? new Date(sessionData.created_at).getTime() : Date.now(),
              updatedAt: sessionData.updated_at ? new Date(sessionData.updated_at).getTime() : Date.now(),
              messages: [],
            };
            
            // Load chat history from events.jsonl
            await this.loadSessionHistory(session, sessionDir);
            
            this.state.sessions.set(sessionId, session);
          }
        } catch (err) {
          // Skip sessions without workspace.yaml
          continue;
        }
      }
      
      console.log(`[Bridge] Loaded ${this.state.sessions.size} historical sessions`);
    } catch (err) {
      console.warn("[Bridge] Could not load historical sessions:", err);
    }
  }

  /**
   * Load chat history from events.jsonl
   */
  private async loadSessionHistory(session: SessionInfo, sessionDir: string): Promise<void> {
    const eventsFile = join(sessionDir, "events.jsonl");
    
    try {
      const content = await readFile(eventsFile, "utf-8");
      const lines = content.trim().split("\n");
      
      let currentUserMessage: MessageInfo | null = null;
      let currentAssistantMessage: MessageInfo | null = null;
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const event = JSON.parse(line);
          const timestamp = new Date(event.timestamp).getTime();
          
          switch (event.type) {
            case "user.message": {
              // Create user message
              const msgId = event.id || this.state.generateMessageId();
              const userContent = event.data?.content || event.data?.transformedContent || "";
              
              currentUserMessage = {
                id: msgId,
                sessionID: session.id,
                role: "user",
                time: { created: timestamp },
                parts: [{
                  id: `part-${msgId}`,
                  messageID: msgId,
                  sessionID: session.id,
                  type: "text",
                  text: userContent,
                }],
              };
              session.messages.push(currentUserMessage);
              break;
            }
            
            case "assistant.turn_start": {
              // Start new assistant message
              const msgId = event.data?.turnId ? `turn-${event.data.turnId}-${event.id}` : event.id;
              currentAssistantMessage = {
                id: msgId,
                sessionID: session.id,
                role: "assistant",
                time: { created: timestamp },
                parts: [],
              };
              session.messages.push(currentAssistantMessage);
              break;
            }
            
            case "assistant.message": {
              if (!currentAssistantMessage) break;
              
              // Add text content if present
              if (event.data?.content) {
                const partId = `part-text-${event.id}`;
                currentAssistantMessage.parts.push({
                  id: partId,
                  messageID: currentAssistantMessage.id,
                  sessionID: session.id,
                  type: "text",
                  text: event.data.content,
                });
              }
              
              // Add reasoning if present
              if (event.data?.reasoningText) {
                const partId = `part-thinking-${event.id}`;
                currentAssistantMessage.parts.push({
                  id: partId,
                  messageID: currentAssistantMessage.id,
                  sessionID: session.id,
                  type: "thinking",
                  thinking: event.data.reasoningText,
                });
              }
              
              // Add tool requests
              if (event.data?.toolRequests) {
                for (const tool of event.data.toolRequests) {
                  const partId = `part-tool-${tool.toolCallId}`;
                  currentAssistantMessage.parts.push({
                    id: partId,
                    messageID: currentAssistantMessage.id,
                    sessionID: session.id,
                    type: "tool-invocation",
                    toolInvocation: {
                      toolCallId: tool.toolCallId,
                      toolName: tool.name,
                      args: tool.arguments,
                    },
                    state: { status: "completed" },
                  });
                }
              }
              
              // Update model info
              if (event.data?.modelId) {
                currentAssistantMessage.modelID = event.data.modelId;
              }
              break;
            }
            
            case "tool.execution_complete": {
              // Find the tool part and update with result
              if (currentAssistantMessage && event.data?.toolCallId) {
                const toolPart = currentAssistantMessage.parts.find(
                  (p: any) => p.toolInvocation?.toolCallId === event.data.toolCallId
                );
                if (toolPart) {
                  (toolPart as any).state = {
                    status: "completed",
                    output: event.data.result,
                  };
                }
              }
              break;
            }
            
            case "assistant.turn_end": {
              if (currentAssistantMessage) {
                currentAssistantMessage.time.completed = timestamp;
              }
              currentAssistantMessage = null;
              break;
            }
          }
        } catch {
          // Skip malformed lines
          continue;
        }
      }
    } catch {
      // No events.jsonl - that's fine for new sessions
    }
  }

  /**
   * Simple YAML parser for workspace.yaml files
   */
  private parseWorkspaceYaml(content: string): Record<string, string> | null {
    try {
      const result: Record<string, string> = {};
      const lines = content.split("\n");
      
      for (const line of lines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        result[key] = value;
      }
      
      return result;
    } catch {
      return null;
    }
  }

  private async startCopilotACP(): Promise<void> {
    console.log("[Bridge] Starting Copilot ACP server...");

    const isWindows = process.platform === "win32";
    
    // Build CLI arguments
    const args = [
      "--acp",
      "--port", COPILOT_ACP_PORT.toString(),
      "--allow-all",
      // Enable all GitHub MCP tools for full CLI parity
      "--enable-all-github-mcp-tools",
    ];

    // Add model from config if available
    if (userConfig.model) {
      args.push("--model", userConfig.model);
      console.log(`[Bridge] Using model: ${userConfig.model}`);
    }

    // Add trusted folders as additional directories
    if (userConfig.trusted_folders && userConfig.trusted_folders.length > 0) {
      for (const folder of userConfig.trusted_folders) {
        args.push("--add-dir", folder);
      }
      console.log(`[Bridge] Added ${userConfig.trusted_folders.length} trusted folders`);
    }

    // Add allowed URLs
    if (userConfig.allowed_urls && userConfig.allowed_urls.length > 0) {
      for (const url of userConfig.allowed_urls) {
        args.push("--allow-url", url);
      }
      console.log(`[Bridge] Added ${userConfig.allowed_urls.length} allowed URLs`);
    }

    console.log(`[Bridge] Copilot args: ${args.join(" ")}`);

    this.copilotProcess = spawn(
      "copilot",
      args,
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
          ...(update.content?.[0]?.type === "text" && {
            output: (update.content[0] as ACP.TextContent).text,
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

    // Get directory from header - null means no filtering (list all)
    const directoryHeader = req.headers["x-opencode-directory"] as string | undefined;
    const directory = directoryHeader || COPILOT_CWD;

    try {
      // Route requests
      if (path === "/global/event" && method === "GET") {
        this.handleSSE(req, res);
      } else if (path === "/session/reload" && method === "POST") {
        await this.handleReloadSessions(res);
      } else if (path === "/session" && method === "GET") {
        this.handleListSessions(res, directoryHeader ? directory : null);
      } else if (path === "/session" && method === "POST") {
        await this.handleCreateSession(req, res, directory);
      } else if (path.match(/^\/session\/[^/]+$/) && method === "GET") {
        const sessionId = path.split("/")[2];
        this.handleGetSession(res, sessionId);
      } else if (path.match(/^\/session\/[^/]+$/) && method === "DELETE") {
        const sessionId = path.split("/")[2];
        await this.handleDeleteSession(res, sessionId);
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

  private handleListSessions(res: ServerResponse, directory: string | null): void {
    let sessions = Array.from(this.state.sessions.values());
    
    // Only filter by directory if one was explicitly provided
    if (directory !== null) {
      sessions = sessions.filter((s) => s.cwd === directory);
    }
    
    const result = sessions.map((s) => this.convertSessionToOpenCode(s));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }

  /**
   * Reload sessions from disk, merging new sessions with existing ones
   */
  private async handleReloadSessions(res: ServerResponse): Promise<void> {
    console.log(`[Bridge] Reloading sessions from ${COPILOT_SESSION_STATE_DIR}...`);
    console.log(`[Bridge] Currently loaded sessions: ${this.state.sessions.size}`);
    
    try {
      const entries = await readdir(COPILOT_SESSION_STATE_DIR, { withFileTypes: true });
      const directories = entries.filter(e => e.isDirectory());
      console.log(`[Bridge] Found ${directories.length} directories in session-state folder`);
      
      let newCount = 0;
      let reloadedEvents = 0;
      let skippedNoWorkspace = 0;
      let skippedParseError = 0;
      
      for (const entry of directories) {
        const sessionId = entry.name;
        
        // If already loaded, reload events only
        if (this.state.sessions.has(sessionId)) {
          const session = this.state.sessions.get(sessionId)!;
          const sessionDir = join(COPILOT_SESSION_STATE_DIR, sessionId);
          const oldMessageCount = session.messages.length;
          session.messages = []; // Clear and reload
          await this.loadSessionHistory(session, sessionDir);
          if (session.messages.length !== oldMessageCount) {
            reloadedEvents++;
            console.log(`[Bridge] Reloaded events for session: ${sessionId} (${oldMessageCount} -> ${session.messages.length} messages)`);
          }
          continue;
        }
        
        const sessionDir = join(COPILOT_SESSION_STATE_DIR, sessionId);
        const workspaceFile = join(sessionDir, "workspace.yaml");
        
        try {
          const content = await readFile(workspaceFile, "utf-8");
          const sessionData = this.parseWorkspaceYaml(content);
          
          if (sessionData) {
            const cwd = sessionData.cwd || sessionData.git_root || COPILOT_CWD;
            let title = sessionData.summary;
            if (!title) {
              const createdDate = sessionData.created_at 
                ? new Date(sessionData.created_at).toLocaleString()
                : new Date().toLocaleString();
              title = `Session - ${createdDate}`;
            }
            
            const session: SessionInfo = {
              id: sessionId,
              cwd,
              projectID: generateProjectID(cwd),
              title,
              createdAt: sessionData.created_at ? new Date(sessionData.created_at).getTime() : Date.now(),
              updatedAt: sessionData.updated_at ? new Date(sessionData.updated_at).getTime() : Date.now(),
              messages: [],
            };
            
            await this.loadSessionHistory(session, sessionDir);
            this.state.sessions.set(sessionId, session);
            newCount++;
            console.log(`[Bridge] Loaded new session: ${sessionId} (${title})`);
          } else {
            skippedParseError++;
            console.log(`[Bridge] Failed to parse workspace.yaml for session: ${sessionId}`);
          }
        } catch (err) {
          skippedNoWorkspace++;
          // Session might not have workspace.yaml yet
        }
      }
      
      console.log(`[Bridge] Reload complete: ${newCount} new, ${reloadedEvents} events reloaded, ${skippedNoWorkspace} no workspace.yaml, ${skippedParseError} parse errors`);
      console.log(`[Bridge] Total sessions now: ${this.state.sessions.size}`);
      
      // Return all sessions
      const sessions = Array.from(this.state.sessions.values());
      const result = sessions.map((s) => this.convertSessionToOpenCode(s));
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error("[Bridge] Failed to reload sessions:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to reload sessions" }));
    }
  }

  private async handleCreateSession(
    req: IncomingMessage,
    res: ServerResponse,
    directory: string
  ): Promise<void> {
    const body = await this.readBody(req);
    const { title } = body as { title?: string };

    // Create session via ACP with loaded MCP servers
    console.log(`[Bridge] Creating session in directory: ${directory} with ${loadedMcpServers.length} MCP servers`);
    if (loadedMcpServers.length > 0) {
      console.log(`[Bridge] MCP servers: ${JSON.stringify(loadedMcpServers)}`);
    }
    
    let result: ACP.NewSessionResult;
    try {
      result = await this.acp.newSession(directory, loadedMcpServers);
    } catch (err) {
      console.error(`[Bridge] Failed to create session:`, err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to create session" }));
      return;
    }

    // Create a readable default title with date/time
    const now = new Date();
    const defaultTitle = `New Session - ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

    const session: SessionInfo = {
      id: result.sessionId,
      cwd: directory,
      projectID: generateProjectID(directory),
      title: title || defaultTitle,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    this.state.sessions.set(session.id, session);
    this.state.loadedAcpSessions.add(session.id); // Mark as loaded in ACP

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

  private async handleDeleteSession(res: ServerResponse, sessionId: string): Promise<void> {
    // Remove from memory
    this.state.sessions.delete(sessionId);
    
    // Delete session directory from disk
    const sessionDir = join(COPILOT_SESSION_STATE_DIR, sessionId);
    try {
      await rm(sessionDir, { recursive: true, force: true });
      console.log(`[Bridge] Deleted session directory: ${sessionDir}`);
    } catch (err) {
      console.warn(`[Bridge] Failed to delete session directory: ${sessionDir}`, err);
    }
    
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

    // Load session in ACP if it's a historical session that hasn't been loaded yet
    if (!this.state.loadedAcpSessions.has(sessionId)) {
      // Check if loadSession is supported by the agent
      if (this.acp.supportsLoadSession()) {
        try {
          console.log(`[Bridge] Loading historical session ${sessionId} in ACP with ${loadedMcpServers.length} MCP servers`);
          await this.acp.loadSession(sessionId, session.cwd, loadedMcpServers);
          this.state.loadedAcpSessions.add(sessionId);
        } catch (err) {
          console.error(`[Bridge] Failed to load session ${sessionId}:`, err);
          // If load fails, try creating a new session instead
          try {
            console.log(`[Bridge] Creating new ACP session for ${sessionId}`);
            const result = await this.acp.newSession(session.cwd, loadedMcpServers);
            // Update the session ID in our state
            this.state.sessions.delete(sessionId);
            session.id = result.sessionId;
            this.state.sessions.set(result.sessionId, session);
            this.state.loadedAcpSessions.add(result.sessionId);
          } catch (createErr) {
            console.error(`[Bridge] Failed to create session:`, createErr);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to load or create session" }));
            return;
          }
        }
      } else {
        // Agent doesn't support loadSession, create new session instead
        try {
          console.log(`[Bridge] Agent doesn't support loadSession, creating new ACP session for ${sessionId}`);
          const result = await this.acp.newSession(session.cwd, loadedMcpServers);
          // Update the session ID in our state
          this.state.sessions.delete(sessionId);
          session.id = result.sessionId;
          this.state.sessions.set(result.sessionId, session);
          this.state.loadedAcpSessions.add(result.sessionId);
        } catch (createErr) {
          console.error(`[Bridge] Failed to create session:`, createErr);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to create session" }));
          return;
        }
      }
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
      projectID: session.projectID,
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
