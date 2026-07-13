import { createHash, createHmac } from "node:crypto";

export function money(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

export function textIncludes(text, target) {
  return Boolean(target) && String(text || "").includes(String(target || ""));
}

export function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/\n|；|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function nextFileId(prefix = "file") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function parseMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const chineseAmount = parseChineseMoney(text);
  if (chineseAmount) return chineseAmount;

  const match = text.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return 0;

  if (/万|w/i.test(text)) return number * 10000;
  return number;
}

function parseChineseMoney(text) {
  const source = String(text);
  const chineseMatch = source.match(/[壹贰叁肆伍陆柒捌玖拾佰仟万亿零一二三四五六七八九十百千万两]+(?:元|圆|整|正|人民币|RMB|¥|￥)*/);
  if (!chineseMatch && !/[壹贰叁肆伍陆柒捌玖拾佰仟万亿]/.test(source)) return 0;

  const normalized = (chineseMatch?.[0] || source)
    .replace(/[圆元整正]/g, "")
    .replace(/零/g, "")
    .replace(/两/g, "二")
    .replace(/[壹一]/g, "1")
    .replace(/[贰二]/g, "2")
    .replace(/[叁三]/g, "3")
    .replace(/[肆四]/g, "4")
    .replace(/[伍五]/g, "5")
    .replace(/[陆六]/g, "6")
    .replace(/[柒七]/g, "7")
    .replace(/[捌八]/g, "8")
    .replace(/[玖九]/g, "9")
    .replace(/拾/g, "十")
    .replace(/佰/g, "百")
    .replace(/仟/g, "千");

  const han = normalized.match(/[1-9十百千万亿]+/);
  const hasChineseDigits = /[壹贰叁肆伍陆柒捌玖拾佰仟零一二三四五六七八九十百两]/.test(source);
  if (hasChineseDigits && han && /[十百千万亿]/.test(han[0])) return parseChineseNumber(han[0]);

  const direct = normalized.match(/([1-9]\d*(?:\.\d+)?)\s*(亿|千万|百万|十万|万)/);
  if (direct) return Number(direct[1]) * chineseUnitValue(direct[2]);

  return 0;
}

function chineseUnitValue(unit) {
  return {
    十万: 100000,
    百万: 1000000,
    千万: 10000000,
    万: 10000,
    亿: 100000000
  }[unit] || 1;
}

function parseChineseNumber(value) {
  const digits = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9 };
  const smallUnits = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of value) {
    if (digits[char]) {
      number = digits[char];
      continue;
    }

    if (smallUnits[char]) {
      section += (number || 1) * smallUnits[char];
      number = 0;
      continue;
    }

    if (char === "万" || char === "亿") {
      section += number;
      total += section * chineseUnitValue(char);
      section = 0;
      number = 0;
    }
  }

  return total + section + number;
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacBuffer(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

export function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}
