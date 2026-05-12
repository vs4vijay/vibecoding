import { Box, Text } from "ink";

export type Tab = { key: string; label: string };

type TabsProps = {
  tabs: Tab[];
  activeKey: string;
};

/**
 * Top tab bar à la k9s / lazygit. The active tab is highlighted; each tab
 * shows its keyboard shortcut in brackets, e.g. `[1] Dashboard`.
 */
export function Tabs({ tabs, activeKey }: TabsProps): JSX.Element {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      {tabs.map((t, idx) => {
        const active = t.key === activeKey;
        return (
          <Box key={t.key} marginRight={2}>
            <Text color={active ? "black" : "cyan"} backgroundColor={active ? "cyan" : undefined} bold={active}>
              {` ${idx + 1} `}
            </Text>
            <Text> </Text>
            <Text color={active ? "white" : "gray"} bold={active}>
              {t.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
