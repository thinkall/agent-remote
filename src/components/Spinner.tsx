import { type JSX } from "solid-js";

interface SpinnerProps {
  size?: "small" | "medium" | "large";
  class?: string;
}

export function Spinner(props: SpinnerProps): JSX.Element {
  const sizeMap = {
    small: "w-4 h-4",
    medium: "w-5 h-5",
    large: "w-6 h-6",
  };

  const sizeClass = () => sizeMap[props.size ?? "medium"];

  return (
    <div
      class={`${sizeClass()} border-2 border-current border-t-transparent rounded-full animate-spin ${props.class ?? ""}`}
      data-component="spinner"
      data-size={props.size ?? "medium"}
    />
  );
}
