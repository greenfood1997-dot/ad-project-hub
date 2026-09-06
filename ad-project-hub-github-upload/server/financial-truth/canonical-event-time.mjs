// Accepted FinancialEvent UTC seconds/milliseconds; never normalize stored facts.
export function canonicalTimestampMillis(value,code='INVALID_CANONICAL_TIMESTAMP'){
 const fail=()=>{throw Object.assign(new Error(code),{code});};
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))fail();
 const epoch=Date.parse(value);
 if(!Number.isFinite(epoch)||new Date(epoch).toISOString()!==(value.length===20?value.slice(0,-1)+'.000Z':value))fail();
 return epoch;
}
export function compareCanonicalEventTime(a,b){
 const ae=canonicalTimestampMillis(a.effectiveAt),be=canonicalTimestampMillis(b.effectiveAt);
 const ao=canonicalTimestampMillis(a.occurredAt),bo=canonicalTimestampMillis(b.occurredAt);
 return ae-be
  ||ao-bo
  ||String(a.eventId).localeCompare(String(b.eventId));
}
