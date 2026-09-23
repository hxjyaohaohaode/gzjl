/** Read at submission time, independently from the editor's preview clock. */
export function getWorkEntryActionTime(): number {
  return Date.now();
}
