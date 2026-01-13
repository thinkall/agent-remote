import { Route, Routes } from "@solidjs/router";
import Login from "./pages/Login";
import Chat from "./pages/Chat";

function App() {
  console.log("App component rendering");

  return (
    <div>
      <Routes>
        <Route path="/login" component={Login} />
        <Route path="/" component={Chat} />
      </Routes>
    </div>
  );
}

export default App;
