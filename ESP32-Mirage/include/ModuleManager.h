#ifndef MODULE_MANAGER_H
#define MODULE_MANAGER_H

#include <Arduino.h>
#include <vector>
#include "ModuleInterface.h"

/**
 * ModuleManager - Centralized management for all modules
 * Handles initialization, updates, and orchestration of all modules
 */
class ModuleManager {
private:
    std::vector<ModuleInterface*> modules;
    unsigned long lastUpdateCheck;
    
public:
    ModuleManager() : lastUpdateCheck(0) {}
    
    /**
     * Register a module with the manager
     */
    void registerModule(ModuleInterface* module) {
        if (module != nullptr) {
            modules.push_back(module);
        }
    }
    
    /**
     * Initialize all registered modules
     * @return Number of successfully initialized modules
     */
    int initializeAll() {
        int successCount = 0;
        
        Serial.println("\n[ModuleManager] Initializing modules...");
        
        for (auto module : modules) {
            if (module->isEnabled()) {
                Serial.printf("[ModuleManager] Starting: %s\n", module->getName());
                if (module->begin()) {
                    Serial.printf("[ModuleManager] ✓ %s initialized\n", module->getName());
                    successCount++;
                } else {
                    Serial.printf("[ModuleManager] ✗ %s failed to initialize\n", 
                                 module->getName());
                }
            } else {
                Serial.printf("[ModuleManager] ○ %s disabled\n", module->getName());
            }
        }
        
        Serial.printf("[ModuleManager] Initialized %d/%d modules\n\n", 
                     successCount, getEnabledCount());
        
        return successCount;
    }
    
    /**
     * Update all modules that need updating
     */
    void updateAll() {
        for (auto module : modules) {
            if (module->isEnabled() && module->needsUpdate()) {
                Serial.printf("[ModuleManager] Updating: %s\n", module->getName());
                unsigned long startTime = millis();
                module->update();
                unsigned long duration = millis() - startTime;
                Serial.printf("[ModuleManager] %s updated in %lu ms\n", 
                             module->getName(), duration);
            }
        }
    }
    
    /**
     * Get a specific module by name
     * @param name Module name to search for
     * @return Pointer to module or nullptr if not found
     */
    ModuleInterface* getModule(const char* name) {
        for (auto module : modules) {
            if (strcmp(module->getName(), name) == 0) {
                return module;
            }
        }
        return nullptr;
    }
    
    /**
     * Get total number of registered modules
     */
    int getTotalCount() const {
        return modules.size();
    }
    
    /**
     * Get number of enabled modules
     */
    int getEnabledCount() const {
        int count = 0;
        for (auto module : modules) {
            if (module->isEnabled()) count++;
        }
        return count;
    }
    
    /**
     * Print status of all modules
     */
    void printStatus() {
        Serial.println("\n=== Module Status ===");
        for (auto module : modules) {
            const char* status = module->isEnabled() ? "ENABLED" : "DISABLED";
            unsigned long lastUpdate = module->getLastUpdate();
            unsigned long timeSince = lastUpdate > 0 ? (millis() - lastUpdate) / 1000 : 0;
            
            Serial.printf("%-25s [%s] Last update: %lu seconds ago\n",
                         module->getName(), status, timeSince);
        }
        Serial.println("====================\n");
    }
};

#endif // MODULE_MANAGER_H
