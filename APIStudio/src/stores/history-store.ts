import { create } from 'zustand';
import { ResponseData } from '@/types/response';
import { generateId } from '@/lib/utils';

interface HistoryState {
  history: ResponseData[];
  maxHistorySize: number;

  // Actions
  addToHistory: (data: ResponseData) => void;
  clearHistory: () => void;
  deleteHistoryItem: (id: string) => void;
  getHistoryById: (id: string) => ResponseData | undefined;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  maxHistorySize: 100,

  addToHistory: (data) =>
    set((state) => {
      const newHistory = [data, ...state.history];
      // Keep only the most recent items
      if (newHistory.length > state.maxHistorySize) {
        newHistory.length = state.maxHistorySize;
      }
      return { history: newHistory };
    }),

  clearHistory: () =>
    set({ history: [] }),

  deleteHistoryItem: (id) =>
    set((state) => ({
      history: state.history.filter((item) => item.timestamp !== id),
    })),

  getHistoryById: (id) => {
    return get().history.find((item) => item.timestamp.toString() === id);
  },
}));
