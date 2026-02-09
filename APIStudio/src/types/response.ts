export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  responseTime: number; // milliseconds
  size: number; // bytes
}

export interface ResponseData {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: HttpResponse;
  timestamp: number;
}
