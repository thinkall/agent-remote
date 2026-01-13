import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Auth } from "../lib/auth";

export default function Login() {
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const navigate = useNavigate();

  onMount(() => {
    console.log("📝 Login page mounted");
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    console.log("🔑 Submitting code:", code());

    try {
      const success = await Auth.verify(code());
      console.log("✅ Auth result:", success);
      if (success) {
        navigate("/", { replace: true });
      } else {
        setError("Invalid access code");
      }
    } catch (err) {
      console.error("❌ Auth error:", err);
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-zinc-900">
      <div class="w-full max-w-md p-8 bg-white dark:bg-zinc-800 rounded-lg shadow-md">
        <h1 class="text-2xl font-bold text-center mb-6 text-gray-800 dark:text-white">
          OpenCode Remote
        </h1>

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Access Code
            </label>
            <input
              type="text"
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              placeholder="Enter 6-digit code"
              class="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
              maxLength={6}
              disabled={loading()}
            />
          </div>

          {error() && (
            <div class="text-red-500 text-sm text-center">{error()}</div>
          )}

          <button
            type="submit"
            disabled={loading() || code().length !== 6}
            class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading() ? "Verifying..." : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
