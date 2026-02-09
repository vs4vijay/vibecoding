import { invoke } from '@tauri-apps/api/core';
import { HttpResponse } from '@/types/response';
import { HttpMethod, HttpHeader, QueryParam } from '@/types/request';

export interface SendRequestParams {
  method: HttpMethod;
  url: string;
  headers?: HttpHeader[];
  body?: string;
  timeout?: number;
}

export async function sendHttpRequest(params: SendRequestParams): Promise<HttpResponse> {
  // Convert headers array to object, only including enabled headers
  const headersObj: Record<string, string> = {};
  if (params.headers) {
    params.headers.forEach((header) => {
      if (header.enabled && header.key) {
        headersObj[header.key] = header.value;
      }
    });
  }

  const payload = {
    method: params.method,
    url: params.url,
    headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
    body: params.body,
    timeout: params.timeout || 30,
  };

  try {
    const response = await invoke<HttpResponse>('send_http_request', { payload });
    return response;
  } catch (error) {
    throw new Error(`Request failed: ${error}`);
  }
}

export function buildUrlWithParams(baseUrl: string, params: QueryParam[]): string {
  const enabledParams = params.filter((p) => p.enabled && p.key);
  if (enabledParams.length === 0) return baseUrl;

  const url = new URL(baseUrl);
  enabledParams.forEach((param) => {
    url.searchParams.append(param.key, param.value);
  });
  return url.toString();
}
