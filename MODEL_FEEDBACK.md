# Human corrections and optional Veri training

In Rules, choose Qwen for semantic conditions. In a rule's Review results table, each completed English condition has **Correct Qwen**. Choose a different Match / No match / Uncertain result and save it. Standard conditions, failed requests, rule deletion, and message routing are not training examples. This feedback does not apply rule actions or change the model's displayed answer.

The server preserves the evaluated system policy, visible transaction fields, original model decision, deployment, reviewer and timestamp. It refuses stale transaction revisions and mismatched or cross-company observations. Corrections deduplicate by observation; reviewers can exclude examples without deleting their history. SQLite is the source of truth. A materialized, Git-ignored file lives at `workspace/model-feedback/<company-id>/preferences.jsonl`.

**Rules → Open feedback pipeline** shows corrections, an inline JSONL preview and a full download. Exported rows contain only `prompt` (the actual chat messages), `chosen` and `rejected` (A/B/C). Provenance stays in SQLite, outside model input. Training examples are human opinions and should be reviewed; user corrections are not accountant-certified truth.

## Independent confirmations

1. **Review upload → Confirm upload only** sends the included transaction prompts to `https://api.veri.studio` using `VERI_API_KEY` on the server. The parent comes from the current deployment's completed training job. The service reads its pinned SFT snapshot, preserves its examples, applies corrected answers to identical prompts, and uploads two NEW immutable snapshots: preference rows, and cumulative SFT chat rows. They are separate formats; DPO pairs must not be appended into a chat-format stream. Original datasets and checkpoints remain intact. Upload never submits training.
2. **Review optional retraining** obtains a planning estimate. **Confirm paid training** submits a separate full SFT job on one AWS L4, from the parent's original Qwen base model, replaying the cumulative SFT snapshot. This is NOT DPO and NOT resuming the previous optimizer/checkpoint. The API's intermediate-checkpoint resume requires the same dataset/method, so it is inappropriate for the changed dataset. Existing fine-tuned weights are preserved as their existing artifact/deployment; replay reduces loss of earlier behavior but does not guarantee retention. Compare the new model on independent held-out cases before deployment.
3. **Keep dataset only** cancels the training confirmation. Job status is refreshed on request. There is no automatic training or deployment, no `.env` rewrite, no replacement or deletion of the active model.

The training confirmation expires after ten minutes and is single-use. It pins the uploaded snapshot; corrections added later need a new upload. Submission uses a stable output name to recover an accepted job rather than submitting it twice. The estimate scales with dataset size, at a planning rate of 80 examples/minute (minimum 30 minutes); it is not a runtime prediction or a spending cap. The service checks available balance before submitting.

Progress and errors persist in SQLite. If the server stops during an operation, it does not repeat it automatically. **Check interrupted operation** is available after ten minutes without progress; it looks for an already-submitted training job before unlocking a stale local operation. Remote partial datasets are preserved.

## Verification

Unit/HTTP tests cover observation fidelity, company isolation, stale evidence, duplicate corrections, original-example replay, format separation, explicit independent confirmations, job idempotency, rejected uploads and interrupted operations. Network operations use test doubles; these tests do not upload or train on Veri. `tests/modelFeedback.spec.ts` covers the UI workflow with a local fixture.

This app is a trusted local workspace, like its existing action endpoints; it does not add production authentication or role-based billing authorization. Keys remain server-only and `.env` is ignored by Git.

## Dedicated workspace
Open the Model feedback navigation tab to review proposals and manage exports, uploads, and optional retraining. Corrections remain in Rules → Review results. Discard proposal excludes an example from future exports and uploads; Restore proposal includes it again. Existing remote snapshots are immutable and are not changed by discarding a local proposal.
