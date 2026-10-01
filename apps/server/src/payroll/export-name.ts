/** Keep names valid for both UTF-8 response headers and local file systems. */
export function payrollExportName(name: string) {
  return Array.from(name).map((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || /[\\/:*?"<>|]/.test(char) || (char.length === 1 && code >= 0xd800 && code <= 0xdfff) ? "-" : char;
  }).slice(0, 100).join("").replace(/[. ]+$/, "") || "薪资周期";
}
