/**
 * Type definitions for Agent Client Protocol (ACP)
 * Used by GitHub Copilot CLI in --acp mode
 * 
 * Based on: https://agentclientprotocol.com/protocol/overview
 */

export const PROTOCOL_VERSION = 1;

// ============================================================================
// JSON-RPC Base Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ============================================================================
// Content Types
// ============================================================================

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type ContentBlock = TextContent | ImageContent | ResourceContent;

// ============================================================================
// Initialize
// ============================================================================

export interface ClientCapabilities {
  fs?: boolean;
  terminal?: boolean;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  setMode?: boolean;
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
}

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: ClientCapabilities;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: AgentCapabilities;
}

// ============================================================================
// Session Management
// ============================================================================

export interface McpServerStdio {
  name: string;
  command: string;
  args: string[];
  env?: Array<{ name: string; value: string }>;
}

export interface McpServerHttp {
  type: "http";
  name: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

export interface McpServerSse {
  type: "sse";
  name: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

export type McpServer = McpServerStdio | McpServerHttp | McpServerSse;

export interface NewSessionParams {
  cwd: string;
  mcpServers?: McpServer[];
}

export interface NewSessionResult {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
  mcpServers?: McpServer[];
}

// ============================================================================
// Prompt
// ============================================================================

export interface PromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export type StopReason = 
  | "end_turn" 
  | "max_tokens" 
  | "max_turn_requests" 
  | "refusal" 
  | "cancelled";

export interface PromptResult {
  stopReason: StopReason;
}

// ============================================================================
// Session Updates (Notifications)
// ============================================================================

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "errored" | "cancelled";

export interface ToolCallUpdate {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title?: string;
  kind?: string;
  status: ToolCallStatus;
}

export interface ToolCallStatusUpdate {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  status: ToolCallStatus;
  content?: Array<{
    type: "content";
    content: ContentBlock;
  }>;
}

export interface AgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: ContentBlock;
}

export interface UserMessageChunk {
  sessionUpdate: "user_message_chunk";
  content: ContentBlock;
}

export interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status?: "pending" | "in_progress" | "completed";
}

export interface PlanUpdate {
  sessionUpdate: "plan";
  entries: PlanEntry[];
}

export interface StateUpdate {
  sessionUpdate: "state";
  state: "idle" | "working";
}

export type SessionUpdate = 
  | ToolCallUpdate 
  | ToolCallStatusUpdate 
  | AgentMessageChunk 
  | UserMessageChunk 
  | PlanUpdate
  | StateUpdate;

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

// ============================================================================
// Permission
// ============================================================================

export interface PermissionOption {
  id: string;
  title: string;
  description?: string;
}

export interface RequestPermissionParams {
  sessionId: string;
  title: string;
  description?: string;
  options: PermissionOption[];
  toolCallId?: string;
}

export type PermissionOutcome = 
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface RequestPermissionResult {
  outcome: PermissionOutcome;
}

// ============================================================================
// Cancel
// ============================================================================

export interface CancelParams {
  sessionId: string;
}

// ============================================================================
// Mode (Optional)
// ============================================================================

export interface SetModeParams {
  sessionId: string;
  mode: string;
}

// ============================================================================
// Method Names
// ============================================================================

export const ACP_METHODS = {
  // Client -> Agent
  INITIALIZE: "initialize",
  SESSION_NEW: "session/new",
  SESSION_LOAD: "session/load",
  SESSION_PROMPT: "session/prompt",
  SESSION_CANCEL: "session/cancel",
  SESSION_SET_MODE: "session/set_mode",
  
  // Agent -> Client (methods requiring response)
  REQUEST_PERMISSION: "session/request_permission",
  
  // Agent -> Client (notifications)
  SESSION_UPDATE: "session/update",
} as const;
