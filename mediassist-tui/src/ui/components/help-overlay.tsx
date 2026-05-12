import { Box, Text } from "ink";

type Group = { title: string; keys: { key: string; desc: string }[] };

type HelpOverlayProps = {
  groups: Group[];
};

/**
 * Modal-style help overlay that lists every keybinding. Toggled by `?`
 * from any screen.
 */
export function HelpOverlay({ groups }: HelpOverlayProps): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1}>
      <Text bold color="yellow">
        Keyboard shortcuts
      </Text>
      <Box marginTop={1} flexDirection="row" gap={4}>
        {groups.map((g) => (
          <Box key={g.title} flexDirection="column">
            <Text bold underline>{g.title}</Text>
            {g.keys.map((k) => (
              <Box key={k.key}>
                <Text color="cyan" bold>
                  {k.key.padEnd(10)}
                </Text>
                <Text>{k.desc}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press </Text>
        <Text color="cyan" bold>?</Text>
        <Text dimColor> or </Text>
        <Text color="cyan" bold>esc</Text>
        <Text dimColor> to close</Text>
      </Box>
    </Box>
  );
}
