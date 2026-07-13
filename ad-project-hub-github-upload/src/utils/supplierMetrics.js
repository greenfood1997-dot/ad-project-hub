export function isSupplierSettlementPayable(item = {}) {
  return !/已付|已结|审批已驳回|审批已撤回/.test(String(item.status || ""));
}
