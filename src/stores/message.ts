import { createStore } from "solid-js/store";
import { MessageV2, Permission } from "../types/opencode";

// 与 opencode desktop 完全一致的存储结构
export const [messageStore, setMessageStore] = createStore<{
  message: {
    [sessionID: string]: MessageV2.Info[];  // 按 sessionID 分组，数组按 id 排序
  };
  part: {
    [messageID: string]: MessageV2.Part[];  // 按 messageID 分组，数组按 id 排序
  };
  permission: {
    [sessionID: string]: Permission.Request[];  // 按 sessionID 分组的权限请求队列
  };
  // 折叠/展开状态，以 partID 或特殊 key 为索引
  expanded: {
    [key: string]: boolean;
  };
}>({
  message: {},
  part: {},
  permission: {},
  expanded: {},
});

// Helper functions for expanded state management
export function isExpanded(key: string): boolean {
  return messageStore.expanded[key] ?? false;
}

export function setExpanded(key: string, value: boolean): void {
  setMessageStore("expanded", key, value);
}

export function toggleExpanded(key: string): void {
  setMessageStore("expanded", key, !isExpanded(key));
}
