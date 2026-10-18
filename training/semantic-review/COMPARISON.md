# Semantic review: Jev vs Gemini Flash-Lite vs Qwen vs keyword rules

Same 370 authored-reference cases: 150 existing demo cases and all 220 held-out synthetic overlays. Original records are not modified. Teacher labels are training-only imitation targets. This is a limited hackathon evaluation, not production accounting validation.

| Model | Exact state accuracy | Errors | False matches | Uncertain recall | 50-row app workload |
|---|---:|---:|---:|---:|---:|
| Keyword rules | 76.2% | 0 | 1 | 65.0% | Not measured |
| Jev | 90.5% | 0 | 13 | 86.3% | 3.97 s |
| Gemini 3.5 Flash-Lite (Gemini key) | 87.8% | 0 | 13 | 82.5% | Not measured |
| Qwen3-0.6B original | 50.3% | 3 | 1 | 33.8% | Not measured |
| Qwen3-0.6B SFT | 66.2% | 3 | 8 | 71.3% | 2.24 s |
| Qwen3-1.7B original | 21.4% | 89 | 156 | 0.0% | Not measured |
| Qwen3-1.7B SFT | 67.6% | 0 | 79 | 63.7% | 4.33 s |

Gemini baselines get the same visible fields, Jev's judging instructions and answer options in one batch prompt per group of up to 20 cases, on GEMINI_API_KEY (the AI Gateway key is Jev-only). Gemini returns labels without probabilities; its batch times are model response times, excluding free-tier rate-limit waits.

Gemini 3.5 Flash-Lite (Gemini key): 64,322 tokens for 370 cases.

Gemini 3.5 Flash is not included: the free-tier Gemini key allows 20 Flash requests per day and this benchmark needs about 70 (one per company and criterion group). Flash-Lite is the Gemini comparison.

Jev uses native multi-question requests. Qwen is a generative single-record classifier with bounded concurrency. The 50-row test is one warm-server run with the app concurrency settings; do not generalize it as a statistical speed benchmark. Missing or invalid answers count as errors. Per-request Jev billing and GPU-hour Veri billing are different cost models. Raw Qwen scores are uncalibrated. Optional monotonic calibration uses only held-out synthetic validation cases; real-world calibration is not established. Absent logprobs do not become invented probabilities.

jev 50-row reported request cost: $0.000865074.

qwen 50-row reported request cost: unavailable (GPU time for Qwen).

qwen17 50-row reported request cost: unavailable (GPU time for Qwen).

Qwen3-0.6B SFT agreement on 50 original company-018 records: 29/50. Jev agreement is not independent ground truth. Workload time: Jev 3.97 s; Qwen 2.24 s.

Qwen3-1.7B SFT agreement on 50 original company-018 records: 37/50. Jev agreement is not independent ground truth. Workload time: Jev 3.97 s; Qwen 4.33 s.

Qwen3-1.7B SFT agreement on 416 original company-018 records: 289/416. Jev agreement is not independent ground truth. Workload time: Jev 7.06 s; Qwen 18.34 s.

Training: Qwen3-0.6B and Qwen3-1.7B, full SFT on the same frozen 1,000 examples (800 authored overlays + 200 unreviewed Jev teacher labels), one L4 per job, up to 125 steps. The 1.7B variant was selected after 0.6B validation accuracy of 70.9%, not by changing test labels. No claim of architectural equivalence to Jev or full arbitrary-criterion generalization. See data-audit.json and README.md for overlap and limitations.

Recommendation: retain Jev as the default. The 1.7B model is a working experimental integration, not a quality-equivalent replacement. Its 85% validation accuracy fell to 67.6% on the independent test (54.7% on the existing demo cases; 76.4% on synthetic overlays). It produced 79 false matches versus 13 for Jev. This gap shows limited generalization. Original 1.7B is evaluated under the same strict eight-token letter-output contract; its 89 invalid responses do not establish its performance under longer, optimized prompting. Neither tuned model demonstrates a combined accuracy/speed advantage over Jev in these measurements.

Qwen3-0.6B SFT calibration used 216 validation cases. On the separate test set, match-score Brier was 0.1878 raw and 0.1846 adjusted (lower is better), with 99.2% score coverage. State predictions are unchanged by calibration.

Qwen3-1.7B SFT calibration used 220 validation cases. On the separate test set, match-score Brier was 0.1593 raw and 0.1461 adjusted (lower is better), with 100.0% score coverage. State predictions are unchanged by calibration.
