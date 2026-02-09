#ifndef MODULE_INTERFACE_H
#define MODULE_INTERFACE_H

#include <Arduino.h>

/**
 * Base interface for all modules in ESP32-Mirage
 * Each module should inherit from this class and implement its methods
 */
class ModuleInterface {
public:
    virtual ~ModuleInterface() {}
    
    /**
     * Initialize the module
     * @return true if initialization was successful
     */
    virtual bool begin() = 0;
    
    /**
     * Update the module (fetch new data, refresh state)
     * Should be called periodically from main loop
     */
    virtual void update() = 0;
    
    /**
     * Check if module is enabled
     * @return true if module is enabled
     */
    virtual bool isEnabled() const = 0;
    
    /**
     * Get module name
     * @return Module name as string
     */
    virtual const char* getName() const = 0;
    
    /**
     * Check if module needs update based on its interval
     * @return true if update is needed
     */
    virtual bool needsUpdate() const = 0;
    
    /**
     * Get last update timestamp
     * @return Last update time in milliseconds
     */
    virtual unsigned long getLastUpdate() const = 0;
};

#endif // MODULE_INTERFACE_H
