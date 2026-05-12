import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";

export type Command = {
  name: string;
  aliases?: string[];
  description: string;
  /** Returns the next state — what the caller should do (e.g. switch view). */
  action: () => void;
};

type Props = {
  commands: Command[];
  onClose: () => void;
};

/**
 * k9s-style `:` command palette. Activated by `:` from anywhere; takes a
 * single token (with simple prefix-match autocomplete shown inline) and runs
 * the matched command.
 */
export function CommandPalette({ commands, onClose }: Props): JSX.Element {
  const [value, setValue] = useState("");

  useInput((_, key) => {
    if (key.escape) onClose();
  });

  const term = value.trim().toLowerCase();
  const matches = term
    ? commands.filter(
        (c) =>
          c.name.toLowerCase().startsWith(term) ||
          c.aliases?.some((a) => a.toLowerCase().startsWith(term)),
      )
    : commands;

  const submit = (raw: string): void => {
    const t = raw.trim().toLowerCase();
    const match =
      commands.find((c) => c.name.toLowerCase() === t || c.aliases?.some((a) => a.toLowerCase() === t)) ??
      commands.find(
        (c) => c.name.toLowerCase().startsWith(t) || c.aliases?.some((a) => a.toLowerCase().startsWith(t)),
      );
    if (match) {
      match.action();
      onClose();
    } else {
      // No match — clear and stay open
      setValue("");
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box>
        <Text color="yellow" bold>: </Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} focus={true} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        {matches.slice(0, 6).map((c) => (
          <Box key={c.name}>
            <Text color="cyan" bold>{c.name.padEnd(12)}</Text>
            {c.aliases && c.aliases.length > 0 ? (
              <Text dimColor>{`(${c.aliases.join(", ")})`.padEnd(16)}</Text>
            ) : (
              <Text dimColor>{" ".repeat(16)}</Text>
            )}
            <Text>{c.description}</Text>
          </Box>
        ))}
        {matches.length === 0 ? (
          <Text color="red">No matching command for "{value}"</Text>
        ) : matches.length > 6 ? (
          <Text dimColor>(+{matches.length - 6} more)</Text>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[enter] run · [esc] close</Text>
      </Box>
    </Box>
  );
}
