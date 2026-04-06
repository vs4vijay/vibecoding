export class KeyBindings {
  static readonly QUIT = ['q', 'C-c'];
  static readonly TAB = ['tab'];
  static readonly SHIFT_TAB = ['S-tab'];
  static readonly ENTER = ['enter'];
  static readonly ESCAPE = ['escape'];
  static readonly REFRESH = ['r'];
  static readonly NEW = ['n'];
  static readonly DELETE = ['d'];
  static readonly EDIT = ['e'];
  static readonly QUERY = ['/'];
  static readonly SAVE = ['C-s'];
  static readonly HELP = ['?'];
  static readonly UP = ['up', 'k'];
  static readonly DOWN = ['down', 'j'];
  static readonly PAGE_UP = ['pageup', 'C-b'];
  static readonly PAGE_DOWN = ['pagedown', 'C-f'];
  static readonly HOME = ['home', 'g'];
  static readonly END = ['end', 'G'];
  static readonly COPY = ['c', 'y'];
  static readonly PASTE = ['p'];
  static readonly UNDO = ['u', 'C-z'];
  static readonly SEARCH = ['/', 'C-f'];
  static readonly NEXT = ['n'];
  static readonly PREVIOUS = ['N', 'p'];
}

export const helpText = `
╔════════════════════════════════════════════════════════════════════╗
║                    Cosmos DB TUI - Keyboard Shortcuts              ║
╠════════════════════════════════════════════════════════════════════╣
║ NAVIGATION                                                         ║
║   Tab / Shift+Tab    Navigate between panels                       ║
║   ↑↓ / j/k          Navigate lists (Vim-style)                     ║
║   Enter             Select/Open item                               ║
║   Esc               Back/Cancel                                    ║
║                                                                    ║
║ GLOBAL ACTIONS                                                     ║
║   q / Ctrl+C        Quit application                               ║
║   r                 Refresh current view                           ║
║   ?                 Show this help                                 ║
║                                                                    ║
║ DATABASE OPERATIONS                                                ║
║   n                 Create new database                            ║
║   d                 Delete selected database                       ║
║                                                                    ║
║ CONTAINER OPERATIONS                                               ║
║   n                 Create new container                           ║
║   d                 Delete selected container                      ║
║                                                                    ║
║ DOCUMENT OPERATIONS                                                ║
║   n                 Create new document                            ║
║   d                 Delete selected document                       ║
║   e                 Edit document (in detail view)                 ║
║   /                 Open SQL query editor                          ║
║                                                                    ║
║ EDITOR                                                             ║
║   Ctrl+S            Save changes                                   ║
║   Esc               Cancel and close                               ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝

Press any key to close...
`;

export interface KeyBinding {
  keys: string[];
  description: string;
  context?: string;
}

export const allKeyBindings: KeyBinding[] = [
  { keys: KeyBindings.QUIT, description: 'Quit application', context: 'global' },
  { keys: KeyBindings.TAB, description: 'Next panel', context: 'global' },
  { keys: KeyBindings.SHIFT_TAB, description: 'Previous panel', context: 'global' },
  { keys: KeyBindings.ENTER, description: 'Select/Open', context: 'lists' },
  { keys: KeyBindings.ESCAPE, description: 'Back/Cancel', context: 'global' },
  { keys: KeyBindings.REFRESH, description: 'Refresh view', context: 'global' },
  { keys: KeyBindings.NEW, description: 'Create new item', context: 'all panels' },
  { keys: KeyBindings.DELETE, description: 'Delete item', context: 'all panels' },
  { keys: KeyBindings.EDIT, description: 'Edit document', context: 'detail view' },
  { keys: KeyBindings.QUERY, description: 'SQL query', context: 'documents' },
  { keys: KeyBindings.SAVE, description: 'Save changes', context: 'editors' },
  { keys: KeyBindings.HELP, description: 'Show help', context: 'global' },
];
