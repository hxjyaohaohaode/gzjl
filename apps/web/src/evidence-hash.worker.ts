import { hashFileSlices } from "./evidence-hash-core.js";
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const sha256 = await hashFileSlices(event.data.file, (progress) => self.postMessage({ progress }));
    self.postMessage({ sha256 });
  } catch { self.postMessage({ error: "无法读取文件内容，请重新选择文件。" }); }
};
