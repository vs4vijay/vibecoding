import { useState } from 'react';
import { Globe, Plus, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useEnvironmentStore } from '@/stores/environment-store';

interface EnvironmentManagerProps {
  onClose?: () => void;
}

export function EnvironmentManager({ onClose }: EnvironmentManagerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [newEnvName, setNewEnvName] = useState('');
  const [showNewEnv, setShowNewEnv] = useState(false);

  const environments = useEnvironmentStore((state) => state.environments);
  const activeEnvironmentId = useEnvironmentStore((state) => state.activeEnvironmentId);
  const addEnvironment = useEnvironmentStore((state) => state.addEnvironment);
  const updateEnvironment = useEnvironmentStore((state) => state.updateEnvironment);
  const deleteEnvironment = useEnvironmentStore((state) => state.deleteEnvironment);
  const setActiveEnvironment = useEnvironmentStore((state) => state.setActiveEnvironment);

  const activeEnv = environments.find((env) => env.id === activeEnvironmentId);

  const handleCreateEnvironment = () => {
    if (newEnvName.trim()) {
      addEnvironment(newEnvName, [{ key: '', value: '', enabled: true }]);
      setNewEnvName('');
      setShowNewEnv(false);
    }
  };

  const handleAddVariable = (envId: string) => {
    const env = environments.find((e) => e.id === envId);
    if (env) {
      updateEnvironment(envId, {
        variables: [...env.variables, { key: '', value: '', enabled: true }],
      });
    }
  };

  const handleUpdateVariable = (
    envId: string,
    index: number,
    field: 'key' | 'value' | 'enabled',
    value: string | boolean
  ) => {
    const env = environments.find((e) => e.id === envId);
    if (env) {
      const newVariables = [...env.variables];
      newVariables[index] = { ...newVariables[index], [field]: value };
      updateEnvironment(envId, { variables: newVariables });
    }
  };

  const handleRemoveVariable = (envId: string, index: number) => {
    const env = environments.find((e) => e.id === envId);
    if (env) {
      const newVariables = env.variables.filter((_, i) => i !== index);
      updateEnvironment(envId, { variables: newVariables });
    }
  };

  if (!isOpen) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <Select
          value={activeEnvironmentId || ''}
          onChange={(e) => setActiveEnvironment(e.target.value || null)}
          className="flex-1"
        >
          <option value="">No Environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" onClick={() => setIsOpen(true)}>
          Manage
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[800px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Environment Variables</h2>
          <Button size="sm" variant="ghost" onClick={() => setIsOpen(false)}>
            Close
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {showNewEnv ? (
            <div className="mb-4 flex gap-2">
              <Input
                placeholder="Environment name (e.g., Development, Production)"
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateEnvironment()}
                autoFocus
              />
              <Button onClick={handleCreateEnvironment}>Create</Button>
              <Button variant="outline" onClick={() => setShowNewEnv(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button className="mb-4" onClick={() => setShowNewEnv(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Environment
            </Button>
          )}

          {environments.length === 0 && !showNewEnv && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No environments yet</p>
              <p className="text-sm mt-1">Create one to store variables</p>
            </div>
          )}

          {environments.map((env) => (
            <div key={env.id} className="mb-6 border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{env.name}</h3>
                  {env.id === activeEnvironmentId && (
                    <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {env.id !== activeEnvironmentId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveEnvironment(env.id)}
                    >
                      Set Active
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteEnvironment(env.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {env.variables.map((variable, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={variable.enabled}
                      onChange={(e) =>
                        handleUpdateVariable(env.id, index, 'enabled', e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                    <Input
                      placeholder="Variable name"
                      value={variable.key}
                      onChange={(e) =>
                        handleUpdateVariable(env.id, index, 'key', e.target.value)
                      }
                      className="flex-1"
                    />
                    <Input
                      placeholder="Value"
                      value={variable.value}
                      onChange={(e) =>
                        handleUpdateVariable(env.id, index, 'value', e.target.value)
                      }
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveVariable(env.id, index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => handleAddVariable(env.id)}
              >
                <Plus className="mr-2 h-3 w-3" />
                Add Variable
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
