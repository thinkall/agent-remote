import { For, Show, Suspense, createMemo } from "solid-js";
import { Part } from "./share/part";
import { MessageWithParts } from "../stores/message";

interface MessageListProps {
  messages: MessageWithParts[];
}

export function MessageList(props: MessageListProps) {
  return (
    <div class="flex flex-col gap-6 py-4">
      <For each={props.messages}>
        {(msg, msgIndex) => {
          const filteredParts = createMemo(() =>
            msg.parts.filter((x, index) => {
              // Same filtering logic as in Share.tsx
              if (x.type === "step-start" && index > 0) return false;
              if (x.type === "snapshot") return false;
              if (x.type === "patch") return false;
              if (x.type === "step-finish") return false;
              if (x.type === "text" && x.synthetic === true) return false;
              if (x.type === "tool" && x.tool === "todoread") return false;
              if (x.type === "text" && !x.text) return false;
              if (
                x.type === "tool" &&
                (x.state.status === "pending" || x.state.status === "running")
              )
                return false;
              return true;
            }),
          );

          return (
            <div class="flex flex-col gap-2">
              <Suspense>
                <For each={filteredParts()}>
                  {(part, partIndex) => {
                    const last = createMemo(
                      () =>
                        props.messages.length === msgIndex() + 1 &&
                        filteredParts().length === partIndex() + 1,
                    );

                    return (
                      <Part
                        last={last()}
                        part={part}
                        index={partIndex()}
                        message={msg}
                      />
                    );
                  }}
                </For>
              </Suspense>
            </div>
          );
        }}
      </For>
    </div>
  );
}
