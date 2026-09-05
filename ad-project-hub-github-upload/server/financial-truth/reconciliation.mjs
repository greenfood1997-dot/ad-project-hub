function reconcile(legacy, projected) { if (!Number.isSafeInteger(legacy) || !Number.isSafeInteger(projected) || legacy < 0 || projected < 0) return { status: "UNKNOWN", legacy, projected, difference: null }; return { status: legacy === projected ? "MATCH" : "MISMATCH", legacy, projected, difference: projected - legacy }; }
export const reconcileProjectPaid = ({ legacyPaid, projectedPaid }) => reconcile(legacyPaid, projectedPaid);
export const reconcileProjectCost = ({ legacyCostUsed, projectedCost }) => reconcile(legacyCostUsed, projectedCost);
export const reconcileReceivable = ({ legacyReceivable, projectedReceivable }) => reconcile(legacyReceivable, projectedReceivable);
