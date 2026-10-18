# Semantic review model: Qwen vs Jev

These experiments use Qwen/Qwen3-0.6B and Qwen/Qwen3-1.7B, full supervised fine-tuning on Veri. Each predicts A=match, B=no_match, C=uncertain for a criterion and one visible bill. They are not the earlier bank/document-linking model, Jev's architecture, or a calibrated decision head. The 1.7B follow-up uses the same frozen training data and was selected because the 0.6B validation result (70.9%) was insufficient. See COMPARISON.md for measured results; matching the interface does not imply matching Jev's quality.

## Data

- 70 companies provide training contexts; 15 validation; 15 test. Company-030 and the existing 30-row authored demo are held out of training.
- 800 generated training examples cover 15 criterion families: text quality, contradiction/agreement, category membership, delay, goods, overhead and compound criteria. Description, memo and item names are explicitly modified synthetic overlays, not defects discovered in the books.
- 200 original training-company records have Jev teacher predictions. These are imitation targets, not independently verified truth. Initial teacher call costs were not retained across the resumable collection; consult gateway billing rather than interpreting a missing cost as free.
- The source YAML files and hidden simulation files are not modified or used as label sources. Simulation IDs, provenance and expected labels are excluded from model inputs.
- There are 220 validation and 220 test overlay cases with separate companies and phrase banks. The benchmark currently uses all 220 synthetic test cases plus all 150 existing demo labels. The demo labels are authored references, not accountant-certified ground truth. Entire unseen policy families and production accounting reliability are not established.

## Training

`train.jsonl` contains 1,000 chat examples with a system policy, JSON-visible data and a single-letter assistant answer. Both jobs use one epoch, up to 125 optimizer steps, sequence length 1024, microbatch 1, accumulation 8, one AWS L4-24GB. Learning rate: 5e-5 for 0.6B; 3e-5 with gradient checkpointing for 1.7B. No LoRA: final full weights can deploy by Veri job id. See train.toml, veri-job.json and qwen17/train.toml, qwen17/job.json. The frozen Veri dataset id is 5a33a7d072c2.

The estimate uses 125 assumed minutes, $2.1875 at $1.05/h. The SDK treats steps as minutes for its estimate; this is not a runtime prediction. Actual billed amounts must be read from Veri after completion.

## App

Set server-only AI_GATEWAY_API_KEY, VERI_API_KEY and VERI_DEPLOYMENT_ID in .env (ignored, never sent to browser). ACCOUNTING_DATA_ROOT can point to an existing untouched dataset. Qwen also discovers the deployment id from qwen-deployment.json if the environment does not set it.

`npm run dev`; choose Jev or Qwen in the Model selector. `?model=jev` and `?model=qwen` select the provider. Switching reloads the page and separates in-memory judgment caches. Rule execution, ALL/ANY/NOT, local standard comparisons, review state, actions and undo remain in application code. History snapshots record the selected provider; historical entries without it remain intact.

Qwen returns the same semantic states. Invalid/missing outputs are errors, never no_match. Candidate scores are computed only if all A/B/C token logprobs are present, normalized over those choices. They are **uncalibrated**, labeled accordingly, and absent scores are not fabricated. They do not reproduce Jev probabilities. If validation scores cover at least 90% of 220 held-out cases, monotonic Platt scaling is fitted on that validation set only. The app labels these validation-adjusted scores; test labels are never used for calibration. Real-world calibration is not established. GPU-hour billing is displayed separately from per-request gateway costs.

## Reproduce

- `npm run benchmark:semantic -- heuristic`
- `npm run benchmark:semantic -- jev`
- `npm run benchmark:semantic -- base` (base-deployment.json must be serving)
- `npm run benchmark:semantic -- qwen` (tuned deployment must be serving)
- `npm run benchmark:semantic -- base17` (original 1.7B deployment must be serving)
- `npm run benchmark:semantic -- qwen17` (tuned 1.7B deployment must be serving)
- `npm run benchmark:workload -- qwen17 all` (all 416 original bills in company-018)

Prediction logs include errors, case identity and timing. Comparisons use the same visible inputs. Existing outputs resume completed cases; remove or archive the relevant prediction log for a fresh run. Jev uses native batches up to 20; Qwen processes up to 3 concurrent record requests per batch. These are app-workload measurements, not equal-token engine benchmarks. Report both quality and architecture differences; do not claim a speed/cost win without the data.

The keyword baseline is a limited implementation using known empty/vague patterns and category words. It does not exhaust all possible rules or classical ML methods. Comparison deployments are stopped after use; the final tuned deployment is configured to scale to zero after 300 idle seconds. Rerunning a stopped baseline requires creating a new deployment and updating its deployment metadata. Saved benchmark results remain readable without a running GPU.

## Verification

Unit tests cover invalid outputs, absent scores, logprob-derived scores, exact cents and the existing three-valued rule engine. `npm run typecheck`, `npm test`, `npm run build`.

The existing browser suite could not launch Chrome in the sandbox (process aborted before loading the app). This is an environment limitation, not a passing browser test. In-app-browser smoke checks are reported separately.
