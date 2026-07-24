import { recognizeFileWithTencentOcr, recognizeFileWithTencentOcrDetailed, tencentOcrConfigured } from "./tencent-ocr.mjs";
import { extractPptxContent } from "./pptx-extraction-service.mjs";

export async function extractFileContent(file, options = {}) {
  const shouldUseOcrForPdf = typeof options.shouldUseOcrForPdf === "function"
    ? options.shouldUseOcrForPdf
    : (text) => !String(text || "").trim();
  const name = file.name || "未命名文件";
  const type = file.type || "";
  const lowerName = name.toLowerCase();
  const fallback = {
    ...file,
    text: file.text || `文件名：${name}\n文件类型：${type || "unknown"}\n文件大小：${file.size || 0} bytes`,
    extractionStatus: "仅记录文件信息"
  };

  try {
    if (file.text && !file.base64 && !file.buffer) return { ...file, extractionStatus: "浏览器已读取文本" };
    if (!file.base64 && !file.buffer) return fallback;

    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.base64, "base64");
    if (lowerName.endsWith(".pdf") || type === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      const text = (parsed.text || "").trim();
      if (shouldUseOcrForPdf(text) && tencentOcrConfigured()) {
        const reason = text ? "PDF 文本缺少可解析金额/日期" : "PDF 未提取到文本";
        console.log(`[OCR] ${name}: ${reason}; calling Tencent OCR`);
        try {
          const ocr = await recognizeFileWithTencentOcrDetailed({ ...file, base64: file.base64 || buffer.toString("base64") }, { isPdf: true, pageCount: parsed.numpages });
          console.log(`[OCR] ${name}: Tencent OCR returned ${ocr.text.length} characters`);
          return {
            ...file,
            text: ocr.text,
            tableRows: ocr.tableRows || [],
            ocrPageErrors: ocr.pageErrors || [],
            pageCount: parsed.numpages,
            extractionStatus: ocr.text.trim()
              ? `${reason}，已使用腾讯云 OCR 识别${ocr.pageErrors?.length ? `（${ocr.pageErrors.length} 页失败，已继续识别其余页面）` : ""}`
              : "腾讯云 OCR 未识别到文本"
          };
        } catch (error) {
          console.error(`[OCR] ${name}: Tencent OCR failed: ${error.message}`);
          return {
            ...file,
            text,
            extractionStatus: `${reason}，但腾讯云 OCR 调用失败：${error.message}`
          };
        }
      }
      if (shouldUseOcrForPdf(text) && !tencentOcrConfigured()) {
        console.warn(`[OCR] ${name}: Tencent OCR is not configured`);
      }
      if (!shouldUseOcrForPdf(text)) {
        console.log(`[OCR] ${name}: skipped because PDF text already contains recognizable amount/date fields`);
      }
      return {
        ...file,
        text,
        extractionStatus: text
          ? "PDF 文本提取成功"
          : "PDF 未提取到可解析文本，可能是扫描件或图片合同；需要接入 OCR/视觉模型后才能精准识别"
      };
    }

    if (type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(lowerName)) {
      if (!tencentOcrConfigured()) return fallback;
      try {
        console.log(`[OCR] ${name}: calling Tencent OCR for image`);
        const ocrText = await recognizeFileWithTencentOcr({ ...file, base64: file.base64 || buffer.toString("base64") }, { isPdf: false });
        console.log(`[OCR] ${name}: Tencent OCR returned ${ocrText.length} characters`);
        return {
          ...file,
          text: ocrText,
          extractionStatus: ocrText.trim() ? "图片合同已使用腾讯云 OCR 识别" : "腾讯云 OCR 未识别到文本"
        };
      } catch (error) {
        console.error(`[OCR] ${name}: Tencent OCR failed: ${error.message}`);
        return { ...fallback, extractionStatus: `图片合同腾讯云 OCR 调用失败：${error.message}` };
      }
    }

    if (lowerName.endsWith(".docx") || type.includes("wordprocessingml")) {
      const mammoth = await import("mammoth");
      const parsed = await mammoth.extractRawText({ buffer });
      return { ...file, text: parsed.value || "", extractionStatus: parsed.value ? "Word 文本提取成功" : "Word 未提取到文本" };
    }

    if (lowerName.endsWith(".pptx") || type.includes("presentationml")) {
      const parsed = await extractPptxContent(file);
      return { ...file, ...parsed };
    }

    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsm") || type.includes("spreadsheet")) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const tableRows = [];
      const text = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        rows.forEach((row) => tableRows.push({ sheetName, cells: row.map((cell) => String(cell ?? "").replace(/\r?\n/g, " ")) }));
        const tsv = rows.map((row) => row.map((cell) => String(cell ?? "").replace(/\r?\n/g, " ")).join("\t")).join("\n");
        return `工作表：${sheetName}\n${tsv}`;
      }).join("\n\n");
      return { ...file, text, tableRows, extractionStatus: text ? "Excel 表格提取成功" : "Excel 未提取到表格内容" };
    }

    if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".tsv") || type.startsWith("text/")) {
      return { ...file, text: buffer.toString("utf8"), extractionStatus: "文本文件读取成功" };
    }

    return fallback;
  } catch (error) {
    return { ...fallback, extractionStatus: `文件内容提取失败：${humanizeExtractionError(error, name)}` };
  }
}

function humanizeExtractionError(error, fileName = "文件") {
  const message = String(error?.message || error || "");
  if (/invalid pdf|bad xref|xref|pdf structure|invalid root|no pdf/i.test(message)) {
    return `${fileName} 不是标准 PDF 或文件已损坏，请重新导出 PDF 后上传；如果是扫描件，建议先转成清晰图片或接入 OCR 后再识别`;
  }
  if (/password|encrypted|decrypt/i.test(message)) {
    return `${fileName} 可能被加密或设置了密码，请解除密码后重新上传`;
  }
  if (/end of file|unexpected/i.test(message)) {
    return `${fileName} 内容不完整，可能上传中断或文件损坏，请重新上传完整文件`;
  }
  return message || "文件暂时无法读取，请换一个清晰版本重新上传";
}
