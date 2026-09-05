export function requireTransactionContext(tx) {
  if (!tx || typeof tx.query !== "function") throw new TypeError("Financial Truth adapter requires transaction/client context");
  return tx;
}
