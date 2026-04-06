import { invoke } from '@tauri-apps/api/core';
import { HttpResponse } from '@/types/response';
import { HttpMethod, HttpHeader, QueryParam } from '@/types/request';
import { substituteVariables } from './utils';

export interface SendRequestParams {
  method: HttpMethod;
  url: string;
  headers?: HttpHeader[];
  body?: string;
  timeout?: number;
  variables?: Record<string, string>;
}

export async function sendHttpRequest(params: SendRequestParams): Promise<HttpResponse> {
  const variables = params.variables || {};

  // Substitute variables in URL
  let processedUrl = substituteVariables(params.url, variables);

  // Convert headers array to object, only including enabled headers
  const headersObj: Record<string, string> = {};
  if (params.headers) {
    params.headers.forEach((header) => {
      if (header.enabled && header.key) {
        // Substitute variables in header values
        const key = substituteVariables(header.key, variables);
        const value = substituteVariables(header.value, variables);
        headersObj[key] = value;
      }
    });
  }

  // Substitute variables in body
  let processedBody = params.body;
  if (processedBody) {
    processedBody = substituteVariables(processedBody, variables);
  }

  const payload = {
    method: params.method,
    url: processedUrl,
    headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
    body: processedBody,
    timeout: params.timeout || 30,
  };

  try {
    const response = await invoke<HttpResponse>('send_http_request', { payload });
    return response;
  } catch (error) {
    throw new Error(`Request failed: ${error}`);
  }
}

export function buildUrlWithParams(
  baseUrl: string,
  params: QueryParam[],
  variables?: Record<string, string>
): string {
  const enabledParams = params.filter((p) => p.enabled && p.key);
  if (enabledParams.length === 0) return baseUrl;

  try {
    const url = new URL(baseUrl);
    enabledParams.forEach((param) => {
      const key = variables ? substituteVariables(param.key, variables) : param.key;
      const value = variables ? substituteVariables(param.value, variables) : param.value;
      url.searchParams.append(key, value);
    });
    return url.toString();
  } catch (error) {
    // If URL is invalid, just return the base URL
    return baseUrl;
  }
}
