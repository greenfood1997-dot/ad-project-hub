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
