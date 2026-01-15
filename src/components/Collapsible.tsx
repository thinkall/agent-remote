import { createSignal, ParentProps, Show, createContext, useContext } from "solid-js";

export interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  class?: string;
  defaultOpen?: boolean;
}

function CollapsibleRoot(props: ParentProps<CollapsibleProps>) {
  const [internalOpen, setInternalOpen] = createSignal(props.defaultOpen ?? false);
  
  const isOpen = () => props.open ?? internalOpen();
  
  const handleToggle = () => {
    const newState = !isOpen();
    setInternalOpen(newState);
    props.onOpenChange?.(newState);
  };

  return (
    <div 
      data-component="collapsible"
      data-open={isOpen() ? "" : undefined}
      class={props.class}
    >
      <CollapsibleContext.Provider value={{ isOpen, handleToggle }}>
        {props.children}
      </CollapsibleContext.Provider>
    </div>
  );
}

interface CollapsibleContextType {
  isOpen: () => boolean;
  handleToggle: () => void;
}

const CollapsibleContext = createContext<CollapsibleContextType>();

function useCollapsible() {
  const ctx = useContext(CollapsibleContext);
  if (!ctx) {
    throw new Error("Collapsible components must be used within a Collapsible");
  }
  return ctx;
}

// Trigger component
interface CollapsibleTriggerProps extends ParentProps {
  class?: string;
}

function CollapsibleTrigger(props: CollapsibleTriggerProps) {
  const { handleToggle } = useCollapsible();
  
  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      class={props.class}
      onClick={handleToggle}
    >
      {props.children}
    </button>
  );
}

// Content component
interface CollapsibleContentProps extends ParentProps {
  class?: string;
}

function CollapsibleContent(props: CollapsibleContentProps) {
  const { isOpen } = useCollapsible();
  
  return (
    <Show when={isOpen()}>
      <div data-slot="collapsible-content" class={props.class}>
        {props.children}
      </div>
    </Show>
  );
}

// Arrow component
interface CollapsibleArrowProps {
  class?: string;
}

function CollapsibleArrow(props: CollapsibleArrowProps) {
  const { isOpen } = useCollapsible();
  
  return (
    <div 
      data-slot="collapsible-arrow" 
      class={props.class}
      style={{
        transform: isOpen() ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease"
      }}
    >
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="14" 
        height="14" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        stroke-width="2" 
        stroke-linecap="round" 
        stroke-linejoin="round"
      >
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </div>
  );
}

export const Collapsible = Object.assign(CollapsibleRoot, {
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
  Arrow: CollapsibleArrow,
});
