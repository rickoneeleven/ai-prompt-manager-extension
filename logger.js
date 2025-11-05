// logger.js

/**
 * @fileoverview Provides a simple logging utility for the extension.
 * It prefixes all messages with "[PromptManager]" for easy identification
 * in the browser console.
 */

const logger = {
    /**
     * Logs a standard informational message.
     * @param {...any} args - Arguments to log, similar to console.log.
     */
    log: (...args) => console.log('[PromptManager]', ...args),

    /**
     * Logs an error message.
     * @param {...any} args - Arguments to log, similar to console.error.
     */
    error: (...args) => console.error('[PromptManager]', ...args),

    /**
     * Logs a warning message.
     * @param {...any} args - Arguments to log, similar to console.warn.
     */
    warn: (...args) => console.warn('[PromptManager]', ...args),
};