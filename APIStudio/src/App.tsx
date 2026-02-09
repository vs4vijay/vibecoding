import { useState } from 'react';
import { Moon, Sun, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RequestBuilder } from '@/components/request/RequestBuilder';
import { ResponseViewer } from '@/components/response/ResponseViewer';
import { HttpResponse } from '@/types/response';

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [response, setResponse] = useState<HttpResponse | null>(null);

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="flex h-screen bg-background text-foreground">
        {/* Sidebar */}
        <aside className="w-64 border-r border-border bg-card flex flex-col">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <h1 className="text-xl font-bold text-primary">API Studio</h1>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Collections</span>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="py-8 text-center">No collections yet</p>
              <p className="text-xs text-center">Create a collection to organize your requests</p>
            </div>
          </div>

          <div className="border-t border-border p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDarkMode(!darkMode)}
              className="w-full justify-start"
            >
              {darkMode ? (
                <>
                  <Sun className="mr-2 h-4 w-4" />
                  Light Mode
                </>
              ) : (
                <>
                  <Moon className="mr-2 h-4 w-4" />
                  Dark Mode
                </>
              )}
            </Button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="flex h-14 items-center justify-between border-b border-border px-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">New Request</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">Save</Button>
              <Button variant="outline" size="sm">Share</Button>
            </div>
          </header>

          {/* Request/Response Area */}
          <main className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-auto">
              {/* Request Section */}
              <div className="border-b border-border p-6">
                <RequestBuilder onResponse={setResponse} />
              </div>

              {/* Response Section */}
              <div className="flex-1 p-6 overflow-auto">
                <h3 className="text-sm font-semibold mb-4">Response</h3>
                <ResponseViewer response={response} />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
