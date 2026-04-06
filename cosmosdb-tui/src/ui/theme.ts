export interface Theme {
  border: string;
  selected: {
    bg: string;
    fg: string;
  };
  focus: {
    border: string;
  };
  statusBar: {
    fg: string;
    bg: string;
  };
  helpBar: {
    fg: string;
    bg: string;
  };
}

export const defaultTheme: Theme = {
  border: 'cyan',
  selected: {
    bg: 'blue',
    fg: 'white',
  },
  focus: {
    border: 'green',
  },
  statusBar: {
    fg: 'white',
    bg: 'blue',
  },
  helpBar: {
    fg: 'black',
    bg: 'white',
  },
};

export const darkTheme: Theme = {
  border: 'white',
  selected: {
    bg: 'gray',
    fg: 'white',
  },
  focus: {
    border: 'yellow',
  },
  statusBar: {
    fg: 'white',
    bg: 'black',
  },
  helpBar: {
    fg: 'white',
    bg: 'gray',
  },
};
