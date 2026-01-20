import { render } from "solid-js/web";
import App from "./App";
import "./index.css";

console.log("🚀 OpenCode Remote starting...");

const root = document.getElementById("root");

if (!root) {
  console.error("❌ Root element not found!");
} else {
  console.log("✅ Root element found, rendering app...");
  try {
    render(() => <App />, root);
    console.log("✅ App rendered successfully!");
  } catch (error) {
    console.error("❌ Error rendering app:", error);
  }
}
