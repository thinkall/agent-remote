import { createSignal, createEffect } from "solid-js";
import { IconArrowUp } from "./icons";

interface PromptInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function PromptInput(props: PromptInputProps) {
  const [text, setText] = createSignal("");
  const [textarea, setTextarea] = createSignal<HTMLTextAreaElement>();

  const adjustHeight = () => {
    const el = textarea();
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  createEffect(() => {
    // Reset height when text is cleared
    if (!text()) {
      const el = textarea();
      if (el) el.style.height = "auto";
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text().trim() && !props.disabled) {
        props.onSend(text());
        setText("");
      }
    }
  };

  return (
    <div class="relative w-full max-w-4xl mx-auto bg-white dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-700 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
      <textarea
        ref={setTextarea}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          adjustHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        rows={1}
        disabled={props.disabled}
        class="w-full px-4 py-3 pr-12 bg-transparent resize-none focus:outline-none dark:text-white disabled:opacity-50 max-h-[200px] overflow-y-auto"
        style={{ "min-height": "52px" }}
      />
      <button
        onClick={() => {
          if (text().trim() && !props.disabled) {
            props.onSend(text());
            setText("");
          }
        }}
        disabled={!text().trim() || props.disabled}
        class="absolute right-2 bottom-2 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-zinc-700 disabled:text-gray-400 dark:disabled:text-zinc-500 transition-colors"
        aria-label="Send message"
      >
        <IconArrowUp width={20} height={20} />
      </button>
    </div>
  );
}
