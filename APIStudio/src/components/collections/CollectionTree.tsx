import { useState } from 'react';
import { FolderPlus, Plus, Trash2, Edit2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCollectionStore } from '@/stores/collection-store';
import { useRequestStore } from '@/stores/request-store';

export function CollectionTree() {
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showNewCollection, setShowNewCollection] = useState(false);

  const collections = useCollectionStore((state) => state.collections);
  const addCollection = useCollectionStore((state) => state.addCollection);
  const deleteCollection = useCollectionStore((state) => state.deleteCollection);
  const addRequest = useCollectionStore((state) => state.addRequest);
  const setActiveRequest = useCollectionStore((state) => state.setActiveRequest);
  const activeRequestId = useCollectionStore((state) => state.activeRequestId);
  const loadRequest = useRequestStore((state) => state.loadRequest);

  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      addCollection(newCollectionName);
      setNewCollectionName('');
      setShowNewCollection(false);
    }
  };

  const handleCreateRequest = (collectionId: string) => {
    addRequest(collectionId, {
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: [{ key: '', value: '', enabled: true }],
      queryParams: [{ key: '', value: '', enabled: true }],
    });
  };

  const handleLoadRequest = (requestId: string) => {
    const request = useCollectionStore.getState().getRequestById(requestId);
    if (request) {
      loadRequest(request);
      setActiveRequest(requestId);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm font-semibold">Collections</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setShowNewCollection(true)}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {showNewCollection && (
          <div className="mb-3 flex gap-2">
            <Input
              placeholder="Collection name"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
              className="h-8 text-sm"
              autoFocus
            />
            <Button size="sm" onClick={handleCreateCollection}>
              Add
            </Button>
          </div>
        )}

        {collections.length === 0 && !showNewCollection && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No collections yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create one to organize your requests
            </p>
          </div>
        )}

        {collections.map((collection) => (
          <div key={collection.id} className="mb-2">
            <div className="group flex items-center justify-between p-2 rounded hover:bg-accent">
              <div className="flex items-center gap-2 flex-1">
                <FolderPlus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{collection.name}</span>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => handleCreateRequest(collection.id)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => deleteCollection(collection.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Requests */}
            <div className="ml-6 mt-1 space-y-1">
              {collection.requests.map((request) => (
                <div
                  key={request.id}
                  className={`group flex items-center justify-between p-2 rounded cursor-pointer hover:bg-accent ${
                    activeRequestId === request.id ? 'bg-accent' : ''
                  }`}
                  onClick={() => handleLoadRequest(request.id)}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <span
                      className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                        request.method === 'GET'
                          ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                          : request.method === 'POST'
                          ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                          : request.method === 'PUT'
                          ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                          : request.method === 'DELETE'
                          ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                          : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {request.method}
                    </span>
                    <span className="text-sm truncate">{request.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
