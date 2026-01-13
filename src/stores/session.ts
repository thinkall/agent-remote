import { createStore } from "solid-js/store";

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export const [sessionStore, setSessionStore] = createStore<{
  list: SessionInfo[];
  current: string | null;
  loading: boolean;
}>({
  list: [],
  current: null,
  loading: false,
});
