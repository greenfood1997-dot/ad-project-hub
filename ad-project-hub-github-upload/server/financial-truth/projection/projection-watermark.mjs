import crypto from "node:crypto";
import { buildCanonicalFinancialHistory } from "../history.mjs";
function stable(v){if(Array.isArray(v))return `[${v.map(stable).join(",")}]`;if(v&&typeof v==="object")return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;return JSON.stringify(v);}
export function stableSerialize(value){return stable(value);}
export function buildProjectionWatermark(events){const h=buildCanonicalFinancialHistory(events);const canonical=h.map(e=>JSON.parse(stableSerialize(e)));return Object.freeze({eventCount:h.length,latestCanonicalEventId:h.at(-1)?.eventId??null,canonicalDigest:crypto.createHash("sha256").update(stableSerialize(canonical)).digest("hex")});}
