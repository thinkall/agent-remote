import { Router, Route } from "@solidjs/router";
import { createEffect } from "solid-js";
import { Auth } from "./lib/auth";
import Login from "./pages/Login";
import Chat from "./pages/Chat";

function App() {
  console.log("🎨 App component rendering");
  console.log("🔐 Is authenticated:", Auth.isAuthenticated());

  return (
    <Router>
      <Route path="/login" component={Login} />
      <Route
        path="/"
        component={() => {
          createEffect(() => {
            if (!Auth.isAuthenticated()) {
              console.log("❌ Not authenticated, redirecting to login");
              window.location.href = "/login";
            } else {
              console.log("✅ Authenticated, showing chat");
            }
          });
          return <Chat />;
        }}
      />
    </Router>
  );
}

export default App;
