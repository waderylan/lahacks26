"""Score exported predictions; no dependencies or network calls."""
import csv,json,sys
from pathlib import Path

def key(r):return r['company_id'],r['transaction_id'],r['query_id']
def main():
 if len(sys.argv)!=2:raise SystemExit('Usage: python score_predictions.py predictions.csv')
 root=Path(__file__).resolve().parent
 with (root/'answer_key.csv').open(newline='') as f:truth={key(r):r['expected'] for r in csv.DictReader(f)}
 with Path(sys.argv[1]).open(newline='') as f:rows=list(csv.DictReader(f))
 pred={}
 for r in rows:
  k=key(r);v=r['prediction']
  if k in pred:raise SystemExit('Duplicate prediction key: '+str(k))
  if k not in truth:raise SystemExit('Unknown prediction key: '+str(k))
  if v not in {'match','no_match','uncertain'}:raise SystemExit('Invalid prediction: '+str(v))
  pred[k]=v
 def metrics(keys):
  n=len(keys);tp=sum(truth[k]=='match' and pred.get(k)=='match' for k in keys)
  fp=sum(truth[k]!='match' and pred.get(k)=='match' for k in keys)
  fn=sum(truth[k]=='match' and pred.get(k)!='match' for k in keys)
  return {'expected_pairs':n,'submitted':sum(k in pred for k in keys),'missing':sum(k not in pred for k in keys),'uncertain':sum(pred.get(k)=='uncertain' for k in keys),'exact_accuracy':sum(pred.get(k)==truth[k] for k in keys)/n if n else None,'match_precision':tp/(tp+fp) if tp+fp else None,'match_recall':tp/(tp+fn) if tp+fn else None,'true_positive':tp,'false_positive':fp,'false_negative':fn}
 print(json.dumps({'overall':metrics(list(truth)),'by_query':{q:metrics([k for k in truth if k[2]==q]) for q in sorted({k[2] for k in truth})}},indent=2))
if __name__=='__main__':main()
