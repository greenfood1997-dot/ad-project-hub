import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function UploadProgressPanel"), "upload dialog should render a progress panel");
assert(source.includes("UploadProgressPanel"), "upload dialog should mount UploadProgressPanel");
assert(source.includes("读取文件") && source.includes("AI/OCR识别") && source.includes("预览确认") && source.includes("写入项目"), "upload progress should show all recognition steps");
assert(source.includes("appendPickedFiles"), "file picker and drag-drop should share append logic");
assert(source.includes("setFiles((current) =>") && source.includes("merged.push(file)"), "file picker should append new files instead of replacing current files");
assert(source.includes("uploadedFileKey") && source.includes("keys.has(key)"), "file picker should deduplicate repeated files while appending");
assert(source.includes("已选择 ${merged.length} 个文件，下一步点击 AI 预览识别"), "upload progress should update immediately after files are picked or dropped");
assert(source.includes("progress.step !== \"idle\" || loading || preview || files.length > 0"), "upload progress should remain visible as soon as files exist");
assert(source.includes("文件已加入任务") && source.includes("预览完成前不会写入项目"), "upload progress should clearly explain the pre-preview waiting state");
assert(source.includes("已选择 ${next.length} 个文件，等待重新预览") && source.includes("等待选择文件"), "removing files should keep progress accurate and reset when empty");
assert(source.includes("function dropFiles") && source.includes("event.dataTransfer?.files"), "upload dialog should support real drag-and-drop files");
assert(source.includes("onDrop={dropFiles}") && source.includes("onDragOver={(event) => event.preventDefault()}"), "file drop zone should wire drop and drag-over handlers");
assert(source.includes("function removeFile") && source.includes("移除"), "upload file list should support removing a single file");
assert(source.includes("onMinimize") && source.includes("upload-mini-panel") && source.includes("缩到后台"), "upload task should be minimizable to background");
assert(source.includes("/api/projects/upload-preview"), "upload dialog should preview through backend before writing data");
assert(source.includes("预览阶段不会写入项目"), "upload dialog should make preview-before-write behavior clear");
assert(styles.includes(".upload-progress-panel"), "upload progress panel should have styles");
assert(styles.includes(".upload-mini-panel"), "minimized upload panel should have styles");

console.log("frontend upload progress entry passed");
