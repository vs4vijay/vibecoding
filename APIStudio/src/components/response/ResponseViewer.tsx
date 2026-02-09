import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HttpResponse } from '@/types/response';
import { formatBytes, formatTime } from '@/lib/utils';

interface ResponseViewerProps {
  response: HttpResponse | null;
}

export function ResponseViewer({ response }: ResponseViewerProps) {
  const [activeTab, setActiveTab] = useState('body');

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">No response yet</p>
          <p className="text-sm">Send a request to see the response here</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
    if (status >= 300 && status < 400) return 'text-blue-600 dark:text-blue-400';
    if (status >= 400 && status < 500) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const formatBody = (body: string) => {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Response Stats */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status:</span>
          <span className={`font-semibold ${getStatusColor(response.status)}`}>
            {response.status} {response.statusText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Time:</span>
          <span className="font-medium">{formatTime(response.responseTime)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Size:</span>
          <span className="font-medium">{formatBytes(response.size)}</span>
        </div>
      </div>

      {/* Response Details Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
        </TabsList>

        <TabsContent value="body" className="space-y-2">
          <pre className="w-full min-h-[300px] max-h-[500px] overflow-auto rounded-md border border-input bg-muted/50 px-3 py-2 text-sm font-mono">
            {formatBody(response.body)}
          </pre>
        </TabsContent>

        <TabsContent value="headers" className="space-y-2">
          <div className="rounded-md border border-input">
            {Object.entries(response.headers).map(([key, value]) => (
              <div
                key={key}
                className="flex border-b border-input last:border-b-0 px-3 py-2 text-sm"
              >
                <span className="w-1/3 font-medium text-foreground">{key}:</span>
                <span className="flex-1 text-muted-foreground font-mono">{value}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
