import { create } from 'zustand';
import { Request, HttpMethod, HttpHeader, QueryParam } from '@/types/request';
import { HttpResponse } from '@/types/response';
import { generateId } from '@/lib/utils';

interface RequestState {
  currentRequest: Partial<Request>;
  currentResponse: HttpResponse | null;
  loading: boolean;

  // Actions
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: HttpHeader[]) => void;
  setQueryParams: (params: QueryParam[]) => void;
  setBody: (body: string) => void;
  setResponse: (response: HttpResponse | null) => void;
  setLoading: (loading: boolean) => void;
  resetRequest: () => void;
  loadRequest: (request: Request) => void;
}

const initialRequest: Partial<Request> = {
  method: 'GET',
  url: '',
  headers: [{ key: '', value: '', enabled: true }],
  queryParams: [{ key: '', value: '', enabled: true }],
};

export const useRequestStore = create<RequestState>((set) => ({
  currentRequest: initialRequest,
  currentResponse: null,
  loading: false,

  setMethod: (method) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, method },
    })),

  setUrl: (url) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, url },
    })),

  setHeaders: (headers) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, headers },
    })),

  setQueryParams: (queryParams) =>
    set((state) => ({
      currentRequest: { ...state.currentRequest, queryParams },
    })),

  setBody: (body) =>
    set((state) => ({
      currentRequest: {
        ...state.currentRequest,
        body: { type: 'json', content: body },
      },
    })),

  setResponse: (response) =>
    set({ currentResponse: response }),

  setLoading: (loading) =>
    set({ loading }),

  resetRequest: () =>
    set({
      currentRequest: initialRequest,
      currentResponse: null,
      loading: false,
    }),

  loadRequest: (request) =>
    set({
      currentRequest: request,
      currentResponse: null,
    }),
}));
