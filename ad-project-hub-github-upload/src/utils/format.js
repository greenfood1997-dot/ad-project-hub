export function money(value) {
  const number = Number(value || 0);
  const safeNumber = Number.isFinite(number) ? number : 0;
  return `¥${safeNumber.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function daysFromNow(days = 0) {
  return new Date(Date.now() + Number(days || 0) * 86400000).toISOString().slice(0, 10);
}

export function fileSize(value) {
  const number = Number(value || 0);
  if (number >= 1024 * 1024) return `${Number((number / 1024 / 1024).toFixed(1))} MB`;
  if (number >= 1024) return `${Number((number / 1024).toFixed(1))} KB`;
  return `${number} B`;
}

export function fileDate(value) {
  if (!value) return "时间待记录";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "时间待记录" : date.toLocaleString("zh-CN");
}

export function fileOpenMode(file = {}) {
  const name = String(file.name || "").toLowerCase();
  if (/\.(pdf|png|jpe?g|webp|gif|bmp)$/.test(name) || /^(application\/pdf|image\/)/.test(String(file.type || ""))) return "preview";
  if (/\.(docx?|xlsx?|xlsm|pptx?)$/.test(name) || /(wordprocessingml|spreadsheet|presentationml|msword|ms-excel|ms-powerpoint)/.test(String(file.type || ""))) return "office-preview";
  return "download";
}

export function filePreviewUrl(file = {}) {
  const storageUrl = String(file.storageUrl || "");
  if (!/^https?:\/\//i.test(storageUrl)) return "";
  return fileOpenMode(file) === "office-preview"
    ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(storageUrl)}`
    : storageUrl;
}

export function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename, rows = []) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
