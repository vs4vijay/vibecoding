import { create } from 'zustand';
import { Collection, Folder } from '@/types/collection';
import { Request } from '@/types/request';
import { generateId } from '@/lib/utils';

interface CollectionState {
  collections: Collection[];
  activeCollectionId: string | null;
  activeRequestId: string | null;

  // Actions
  addCollection: (name: string, description?: string) => void;
  updateCollection: (id: string, updates: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
  addFolder: (collectionId: string, name: string, parentFolderId?: string) => void;
  addRequest: (collectionId: string, request: Partial<Request>, folderId?: string) => void;
  updateRequest: (requestId: string, updates: Partial<Request>) => void;
  deleteRequest: (requestId: string) => void;
  setActiveCollection: (id: string | null) => void;
  setActiveRequest: (id: string | null) => void;
  getRequestById: (id: string) => Request | undefined;
  getCollectionById: (id: string) => Collection | undefined;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],
  activeCollectionId: null,
  activeRequestId: null,

  addCollection: (name, description) =>
    set((state) => ({
      collections: [
        ...state.collections,
        {
          id: generateId(),
          name,
          description,
          folders: [],
          requests: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    })),

  updateCollection: (id, updates) =>
    set((state) => ({
      collections: state.collections.map((col) =>
        col.id === id ? { ...col, ...updates, updatedAt: Date.now() } : col
      ),
    })),

  deleteCollection: (id) =>
    set((state) => ({
      collections: state.collections.filter((col) => col.id !== id),
      activeCollectionId:
        state.activeCollectionId === id ? null : state.activeCollectionId,
    })),

  addFolder: (collectionId, name, parentFolderId) =>
    set((state) => ({
      collections: state.collections.map((col) => {
        if (col.id !== collectionId) return col;

        const newFolder: Folder = {
          id: generateId(),
          name,
          collectionId,
          parentFolderId,
          folders: [],
          requests: [],
          createdAt: Date.now(),
        };

        return {
          ...col,
          folders: [...col.folders, newFolder],
          updatedAt: Date.now(),
        };
      }),
    })),

  addRequest: (collectionId, request, folderId) =>
    set((state) => ({
      collections: state.collections.map((col) => {
        if (col.id !== collectionId) return col;

        const newRequest: Request = {
          id: generateId(),
          name: request.name || 'New Request',
          method: request.method || 'GET',
          url: request.url || '',
          headers: request.headers || [],
          queryParams: request.queryParams || [],
          body: request.body,
          auth: request.auth,
          collectionId,
          folderId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        return {
          ...col,
          requests: [...col.requests, newRequest],
          updatedAt: Date.now(),
        };
      }),
    })),

  updateRequest: (requestId, updates) =>
    set((state) => ({
      collections: state.collections.map((col) => ({
        ...col,
        requests: col.requests.map((req) =>
          req.id === requestId ? { ...req, ...updates, updatedAt: Date.now() } : req
        ),
      })),
    })),

  deleteRequest: (requestId) =>
    set((state) => ({
      collections: state.collections.map((col) => ({
        ...col,
        requests: col.requests.filter((req) => req.id !== requestId),
      })),
      activeRequestId: state.activeRequestId === requestId ? null : state.activeRequestId,
    })),

  setActiveCollection: (id) =>
    set({ activeCollectionId: id }),

  setActiveRequest: (id) =>
    set({ activeRequestId: id }),

  getRequestById: (id) => {
    const state = get();
    for (const col of state.collections) {
      const request = col.requests.find((req) => req.id === id);
      if (request) return request;
    }
    return undefined;
  },

  getCollectionById: (id) => {
    return get().collections.find((col) => col.id === id);
  },
}));
