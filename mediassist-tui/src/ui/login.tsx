import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import { login } from "../api/auth.ts";
import type { MediAssistClient } from "../api/client.ts";
import { loadEnv } from "../config.ts";

type Props = {
  /** "expired" surfaces a yellow banner; "first" is the default cold start. */
  reason?: "expired" | "first";
  /** Called once login succeeds and the cookie is persisted. */
  onSuccess: (client: MediAssistClient) => void;
};

/**
 * In-TUI login form. Replaces the previous `@clack/prompts` pre-Ink flow so
 * everything happens inside one render tree — no console flashing, no
 * unmount/remount on re-auth, password input masked.
 *
 * UX rules (mirrors lazygit-style focused forms):
 *  - Tab / Shift+Tab cycles fields
 *  - Enter on username → focus moves to password
 *  - Enter on password → submit
 *  - Esc / Ctrl-C quits the app
 *  - Submit button isn't rendered — Enter on the last field submits, matching
 *    every other in-app form
 */
export function LoginScreen({ reason, onSuccess }: Props): JSX.Element {
  const env = loadEnv();
  const [username, setUsername] = useState(env.MEDIASSIST_USER ?? "");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<"u" | "p">(username ? "p" : "u");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { exit } = useApp();

  useInput(
    (input, key) => {
      if (submitting) return;
      if (key.escape) {
        exit();
        return;
      }
      if (key.tab) {
        setFocused((f) => (f === "u" ? "p" : "u"));
      }
    },
    { isActive: !submitting },
  );

  const submit = async (): Promise<void> => {
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const client = await login(username.trim(), password);
      onSuccess(client);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
      setPassword("");
      setFocused("p");
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="cyan">Medi Assist — Login</Text>
        {reason === "expired" ? (
          <Text color="yellow">⚠ Session expired — please log in again.</Text>
        ) : (
          <Text dimColor>Sign in to portal.mediassist.in</Text>
        )}

        <Box marginTop={1}>
          <Text bold color={focused === "u" ? "cyan" : "gray"}>
            {focused === "u" ? "▶ " : "  "}Username
          </Text>
          <TextInput
            value={username}
            onChange={setUsername}
            focus={focused === "u" && !submitting}
            onSubmit={() => setFocused("p")}
            placeholder="MICR..."
          />
        </Box>
        <Box>
          <Text bold color={focused === "p" ? "cyan" : "gray"}>
            {focused === "p" ? "▶ " : "  "}Password
          </Text>
          <TextInput
            value={password}
            onChange={setPassword}
            mask="•"
            focus={focused === "p" && !submitting}
            onSubmit={() => void submit()}
            placeholder=""
          />
        </Box>

        {error ? (
          <Box marginTop={1}>
            <Text color="red">⚠ {error}</Text>
          </Box>
        ) : null}

        <Box marginTop={1}>
          {submitting ? (
            <Text color="cyan">Logging in…</Text>
          ) : (
            <Text dimColor>[tab] switch field · [enter] continue / submit · [esc] quit</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
