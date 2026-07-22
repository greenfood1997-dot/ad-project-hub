import JSZip from "jszip";
import { recognizeFileWithTencentOcr, tencentOcrConfigured } from "./tencent-ocr.mjs";

const MIN_OCR_IMAGE_BYTES = 24 * 1024;

function decodeXml(value = "") {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideNumber(path = "") {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] || 0);
}

function slideText(xml = "") {
  return [...String(xml).matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean)
    .join("\n");
}

function imageRelationships(xml = "") {
  const relationships = new Map();
  for (const match of String(xml).matchAll(/<Relationship\b([^>]+?)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = match[1] || "";
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] || "";
    if (id && target && /\/image$/i.test(type)) relationships.set(id, target.replace(/^\.\.\//, "ppt/"));
  }
  return relationships;
}

function embeddedRelationshipIds(xml = "") {
  return [...String(xml).matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)].map((match) => match[1]);
}

function imageMimeType(path = "") {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

export async function extractPptxContent(file = {}) {
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(String(file.base64 || ""), "base64");
  if (!buffer.length) throw new Error("PPTX 缺少文件内容");
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const slides = [];
  const tableRows = [];

  for (const path of slidePaths) {
    const page = slideNumber(path);
    const xml = await zip.file(path).async("string");
    const nativeText = slideText(xml);
    const relPath = `ppt/slides/_rels/slide${page}.xml.rels`;
    const relXml = zip.file(relPath) ? await zip.file(relPath).async("string") : "";
    const rels = imageRelationships(relXml);
    const imagePaths = [...new Set(embeddedRelationshipIds(xml).map((id) => rels.get(id)).filter(Boolean))];
    const ocrParts = [];

    if (tencentOcrConfigured()) {
      for (const imagePath of imagePaths) {
        const entry = zip.file(imagePath);
        if (!entry) continue;
        const image = await entry.async("nodebuffer");
        if (image.length < MIN_OCR_IMAGE_BYTES) continue;
        try {
          console.log(`[OCR] ${file.name || "PPTX"}: recognizing slide ${page} image ${imagePath}`);
          const text = await recognizeFileWithTencentOcr({
            name: `${file.name || "PPTX"}-第${page}页-${imagePath.split("/").pop()}`,
            type: imageMimeType(imagePath),
            base64: image.toString("base64")
          });
          if (text.trim()) ocrParts.push(text.trim());
        } catch (error) {
          console.error(`[OCR] ${file.name || "PPTX"}: slide ${page} image failed: ${error.message}`);
        }
      }
    }

    const ocrText = ocrParts.join("\n");
    slides.push({ page, nativeText, ocrText, imageCount: imagePaths.length });
    tableRows.push({ sheetName: `PPT第${page}页`, cells: [nativeText, ocrText].filter(Boolean) });
  }

  const text = slides.map((slide) => [
    `第${slide.page}页`,
    slide.nativeText,
    slide.ocrText && `图片OCR：\n${slide.ocrText}`
  ].filter(Boolean).join("\n")).join("\n\n");
  const ocrSlides = slides.filter((slide) => slide.ocrText).length;
  return {
    text,
    tableRows,
    slides,
    pageCount: slides.length,
    extractionStatus: `PPTX 已提取 ${slides.length} 页原生文字${ocrSlides ? `，并完成 ${ocrSlides} 页图片 OCR` : tencentOcrConfigured() ? "，未发现需 OCR 的大图" : "，OCR 未配置"}`
  };
}

export const pptxInternals = { decodeXml, embeddedRelationshipIds, imageRelationships, slideText };
