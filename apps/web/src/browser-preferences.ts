/** Browser preferences are optional. Privacy settings and full storage must
 * never prevent authentication or render the workbench unusable. */
export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Keep the current in-memory preference. */ }
}
