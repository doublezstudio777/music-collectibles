import json,sys,re
buf=open('tail.jsonl').read();dec=json.JSONDecoder();i=0;ev={}
while i<len(buf):
  while i<len(buf) and buf[i].isspace(): i+=1
  if i>=len(buf):break
  try:o,i=dec.raw_decode(buf,i)
  except Exception:break
  h=((o.get('event') or {}).get('request') or {}).get('headers') or {}
  if h.get('cf-ray'): ev[h['cf-ray'].split('-')[0]]=o
from collections import defaultdict
for tag in sys.argv[1:]:
  rows=json.load(open(f'measure_{tag}.json'))
  print(f'\n##### {tag}')
  agg=defaultdict(lambda:[0,0,0,0,[]])
  for r in rows:
    o=ev.get(r['ray'])
    cpu=o.get('cpuTime') if o else None
    oc=o['outcome'] if o else '?'
    kind='RSC預取' if '_rsc' in r['url'] else ('API' if r['url'].startswith('/api/') else ('圖片' if r['url'].startswith('/img/') else '頁面'))
    a=agg[r['page']]; a[0]+=1
    if cpu is not None: a[1]+=cpu; a[2]=max(a[2],cpu)
    if oc!='ok': a[3]+=1
    a[4].append((kind,r['url'][:60],r['cache'],cpu,oc))
  for p,a in agg.items():
    print(f"{p}: 請求 {a[0]}，CPU 合計 {a[1]}ms，單筆最高 {a[2]}ms，非 ok {a[3]}")
    for k in sorted(a[4],key=lambda x:-(x[3] or 0))[:40]:
      if (k[3] or 0)>=5 or k[0] in('頁面','API') : print('   ',*k,sep='\t')
