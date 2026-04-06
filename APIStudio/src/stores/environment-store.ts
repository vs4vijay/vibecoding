import { create } from 'zustand';
import { Environment, EnvironmentVariable } from '@/types/environment';
import { generateId } from '@/lib/utils';

interface EnvironmentState {
  environments: Environment[];
  activeEnvironmentId: string | null;

  // Actions
  addEnvironment: (name: string, variables?: EnvironmentVariable[]) => void;
  updateEnvironment: (id: string, updates: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnvironment: (id: string | null) => void;
  getActiveEnvironment: () => Environment | null;
  getVariables: () => Record<string, string>;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: [],
  activeEnvironmentId: null,

  addEnvironment: (name, variables = []) =>
    set((state) => {
      const newEnv: Environment = {
        id: generateId(),
        name,
        variables,
        isActive: state.environments.length === 0, // First env is active by default
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      return {
        environments: [...state.environments, newEnv],
        activeEnvironmentId:
          state.environments.length === 0 ? newEnv.id : state.activeEnvironmentId,
      };
    }),

  updateEnvironment: (id, updates) =>
    set((state) => ({
      environments: state.environments.map((env) =>
        env.id === id ? { ...env, ...updates, updatedAt: Date.now() } : env
      ),
    })),

  deleteEnvironment: (id) =>
    set((state) => ({
      environments: state.environments.filter((env) => env.id !== id),
      activeEnvironmentId:
        state.activeEnvironmentId === id ? null : state.activeEnvironmentId,
    })),

  setActiveEnvironment: (id) =>
    set((state) => ({
      environments: state.environments.map((env) => ({
        ...env,
        isActive: env.id === id,
      })),
      activeEnvironmentId: id,
    })),

  getActiveEnvironment: () => {
    const state = get();
    return (
      state.environments.find((env) => env.id === state.activeEnvironmentId) || null
    );
  },

  getVariables: () => {
    const activeEnv = get().getActiveEnvironment();
    if (!activeEnv) return {};

    const variables: Record<string, string> = {};
    activeEnv.variables.forEach((v) => {
      if (v.enabled) {
        variables[v.key] = v.value;
      }
    });

    return variables;
  },
}));
