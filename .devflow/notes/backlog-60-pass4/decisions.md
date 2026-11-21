# Decisions — backlog-60-pass4

## D-1 — T3 contract tensions accepted (lead)

Red gate verified independently: 78 total, 15 FAIL / 63 ok, exact §8
label set. Two T3 findings accepted as plan-code defects (NOT test defects),
fix to be applied by T1 (client lane) as part of Wave 1:
(1) runBatch empty path: with a dirty source draft, targets >= 1 even when
    the target equals the base, and target === null disables the control
    but an edge click reaches target.provider -> TypeError. Frozen fix:
    first lines of runBatch -> `if (batchTarget === null || targets.length === 0) { setLastNotice({ kind: 'error', key: 'batch.empty' }); return; }`.
(2) batch.busy dead reference: the busy markup renders only the CANCEL
    branch, so the inner `batchBusy ? t('batch.busy') : t('batch.apply')`
    is unreachable. P2-N3's held-batch drive asserts BOTH the batch.busy
    text AND the batch.cancel button. Fix: render batch.busy as the busy-state
    label alongside the cancel affordance — keep all 27 dictionary keys,
    122x3, 58 allowlist, and the frozen arithmetic UNCHANGED.
Both are within the plan's stated intent (§2/T4 promise empty path ->
batch.empty and zero POSTs; the frozen 27-key set includes batch.busy) —
no plan edit needed, no user gate.
