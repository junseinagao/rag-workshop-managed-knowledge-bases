/**
 * JSON Config File Store
 *
 * Load / save JSON configuration files used by each module to persist
 * setup state (KB ID, ARNs, etc.) across separate script invocations,
 * and to hand state off to downstream modules (e.g. 01 -> 02 -> 03).
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

/** Load a JSON config file. Returns empty object if the file does not exist. */
export function loadConfig<T = Record<string, unknown>>(path: string): T {
  if (!existsSync(path)) return {} as T
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as T
}

/** Save (merge) data into a JSON config file. Creates the file if it does not exist. */
export function saveConfig(path: string, updates: Record<string, unknown>): void {
  const existing = loadConfig(path)
  const merged = { ...existing, ...updates }
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

/** Delete the config file if it exists. */
export function deleteConfig(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path)
  }
}
