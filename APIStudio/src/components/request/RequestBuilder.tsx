import { useState, useEffect } from 'react';
import { Send, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HttpMethod, HttpHeader, QueryParam } from '@/types/request';
import { sendHttpRequest, buildUrlWithParams } from '@/lib/http-client';
import { HttpResponse } from '@/types/response';
import { useRequestStore } from '@/stores/request-store';
import { useEnvironmentStore } from '@/stores/environment-store';
import { useHistoryStore } from '@/stores/history-store';
import { useCollectionStore } from '@/stores/collection-store';

interface RequestBuilderProps {
  onResponse?: (response: HttpResponse) => void;
}

export function RequestBuilder({ onResponse }: RequestBuilderProps) {
  const currentRequest = useRequestStore((state) => state.currentRequest);
  const setMethod = useRequestStore((state) => state.setMethod);
  const setUrl = useRequestStore((state) => state.setUrl);
  const setHeaders = useRequestStore((state) => state.setHeaders);
  const setQueryParams = useRequestStore((state) => state.setQueryParams);
  const setBody = useRequestStore((state) => state.setBody);
  const setResponse = useRequestStore((state) => state.setResponse);
  const loading = useRequestStore((state) => state.loading);
  const setLoading = useRequestStore((state) => state.setLoading);

  const getVariables = useEnvironmentStore((state) => state.getVariables);
  const addToHistory = useHistoryStore((state) => state.addToHistory);
  const activeRequestId = useCollectionStore((state) => state.activeRequestId);
  const updateRequest = useCollectionStore((state) => state.updateRequest);

  const [activeTab, setActiveTab] = useState('params');

  const method = currentRequest.method || 'GET';
  const url = currentRequest.url || '';
  const headers = currentRequest.headers || [{ key: '', value: '', enabled: true }];
  const queryParams = currentRequest.queryParams || [{ key: '', value: '', enabled: true }];
  const body = currentRequest.body?.content || '';

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '', enabled: true }]);
  };

  const updateHeader = (index: number, field: keyof HttpHeader, value: string | boolean) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    setHeaders(newHeaders);
  };

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const addQueryParam = () => {
    setQueryParams([...queryParams, { key: '', value: '', enabled: true }]);
  };

  const updateQueryParam = (index: number, field: keyof QueryParam, value: string | boolean) => {
    const newParams = [...queryParams];
    newParams[index] = { ...newParams[index], [field]: value };
    setQueryParams(newParams);
  };

  const removeQueryParam = (index: number) => {
    setQueryParams(queryParams.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (activeRequestId) {
      updateRequest(activeRequestId, {
        method,
        url,
        headers,
        queryParams,
        body: body ? { type: 'json', content: body } : undefined,
      });
    }
  };

  const handleSend = async () => {
    if (!url) return;

    setLoading(true);
    try {
      const variables = getVariables();
      const finalUrl = buildUrlWithParams(url, queryParams, variables);

      const response = await sendHttpRequest({
        method,
        url: finalUrl,
        headers,
        body: body || undefined,
        variables,
      });

      setResponse(response);
      onResponse?.(response);

      // Add to history
      addToHistory({
        request: {
          method,
          url: finalUrl,
          headers: headers.reduce((acc, h) => {
            if (h.enabled && h.key) acc[h.key] = h.value;
            return acc;
          }, {} as Record<string, string>),
          body,
        },
        response,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Request failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* URL Bar */}
      <div className="flex gap-2">
        <Select
          value={method}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}
          className="w-32"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="HEAD">HEAD</option>
          <option value="OPTIONS">OPTIONS</option>
        </Select>
        <Input
          placeholder="Enter request URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1"
        />
        <Button onClick={handleSend} disabled={loading || !url}>
          <Send className="mr-2 h-4 w-4" />
          {loading ? 'Sending...' : 'Send'}
        </Button>
      </div>

      {/* Request Details Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="params">Params</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
        </TabsList>

        <TabsContent value="params" className="space-y-2">
          <div className="text-sm font-medium">Query Parameters</div>
          {queryParams.map((param, index) => (
            <div key={index} className="flex gap-2 items-center">
              <input
                type="checkbox"
                checked={param.enabled}
                onChange={(e) => updateQueryParam(index, 'enabled', e.target.checked)}
                className="h-4 w-4"
              />
              <Input
                placeholder="Key"
                value={param.key}
                onChange={(e) => updateQueryParam(index, 'key', e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Value"
                value={param.value}
                onChange={(e) => updateQueryParam(index, 'value', e.target.value)}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeQueryParam(index)}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addQueryParam}>
            Add Parameter
          </Button>
        </TabsContent>

        <TabsContent value="headers" className="space-y-2">
          <div className="text-sm font-medium">Headers</div>
          {headers.map((header, index) => (
            <div key={index} className="flex gap-2 items-center">
              <input
                type="checkbox"
                checked={header.enabled}
                onChange={(e) => updateHeader(index, 'enabled', e.target.checked)}
                className="h-4 w-4"
              />
              <Input
                placeholder="Key"
                value={header.key}
                onChange={(e) => updateHeader(index, 'key', e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Value"
                value={header.value}
                onChange={(e) => updateHeader(index, 'value', e.target.value)}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeHeader(index)}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addHeader}>
            Add Header
          </Button>
        </TabsContent>

        <TabsContent value="body" className="space-y-2">
          <div className="text-sm font-medium">Request Body</div>
          <textarea
            className="w-full min-h-[200px] rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            placeholder="Enter request body (JSON, XML, etc.)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </TabsContent>

        <TabsContent value="auth" className="space-y-2">
          <div className="text-sm font-medium">Authentication</div>
          <p className="text-sm text-muted-foreground">
            Authentication configuration coming soon...
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
