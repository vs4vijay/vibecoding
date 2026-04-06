import { useState } from 'react';
import { Moon, Sun, Share2, History, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RequestBuilder } from '@/components/request/RequestBuilder';
import { ResponseViewer } from '@/components/response/ResponseViewer';
import { CollectionTree } from '@/components/collections/CollectionTree';
import { EnvironmentManager } from '@/components/environment/EnvironmentManager';
import { useRequestStore } from '@/stores/request-store';
import { useCollectionStore } from '@/stores/collection-store';

function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [showEnvManager, setShowEnvManager] = useState(false);

  const currentResponse = useRequestStore((state) => state.currentResponse);
  const activeRequestId = useCollectionStore((state) => state.activeRequestId);
  const updateRequest = useCollectionStore((state) => state.updateRequest);
  const currentRequest = useRequestStore((state) => state.currentRequest);

  const handleSave = () => {
    if (activeRequestId) {
      updateRequest(activeRequestId, {
        ...currentRequest,
        updatedAt: Date.now(),
      });
    }
  };

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="flex h-screen bg-background text-foreground">
        {/* Sidebar */}
        <aside className="w-64 border-r border-border bg-card flex flex-col">
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <h1 className="text-xl font-bold text-primary">API Studio</h1>
          </div>

          <div className="flex-1 overflow-auto">
            <CollectionTree />
          </div>

          <div className="border-t border-border">
            <div className="p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowEnvManager(true)}
                className="w-full justify-start"
              >
                <Settings className="mr-2 h-4 w-4" />
                Environments
              </Button>
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
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="flex h-14 items-center justify-between border-b border-border px-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {activeRequestId ? 'Edit Request' : 'New Request'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button variant="outline" size="sm">
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </Button>
              <Button variant="outline" size="sm">
                <History className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* Request/Response Area */}
          <main className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-auto">
              {/* Request Section */}
              <div className="border-b border-border p-6">
                <RequestBuilder />
              </div>

              {/* Response Section */}
              <div className="flex-1 p-6 overflow-auto">
                <h3 className="text-sm font-semibold mb-4">Response</h3>
                <ResponseViewer response={currentResponse} />
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Environment Manager Modal */}
      {showEnvManager && <EnvironmentManager />}
    </div>
  );
}

export default App;
