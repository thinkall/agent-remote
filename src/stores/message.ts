import { createStore } from "solid-js/store";
import { MessageV2 } from "../types/opencode";

export type MessageWithParts = MessageV2.Info & { parts: MessageV2.Part[] };

export const [messageStore, setMessageStore] = createStore<{
  bySession: Record<string, Record<string, MessageWithParts>>;
}>({
  bySession: {},
});
