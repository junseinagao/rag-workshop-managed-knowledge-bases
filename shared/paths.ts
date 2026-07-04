/**
 * Shared path constants for cross-module config file references
 *
 * Module 01 (knowledge_base) produces a config file that Module 02/03
 * (chart_agent / runtime) consume. Centralizing these paths avoids
 * drift when files are renamed or moved.
 */

import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Knowledge Base config produced by 01_knowledge_base, consumed by 02/03 */
export const KB_CONFIG_PATH = join(ROOT, '01_knowledge_base', '.kb-config.json')
