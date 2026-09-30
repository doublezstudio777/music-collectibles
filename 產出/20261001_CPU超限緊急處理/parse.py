import json,sys,datetime,re
buf=open(sys.argv[1] if len(sys.argv)>1 else 'tail.jsonl').read()
dec=json.JSONDecoder();i=0;rows=[]
while i<len(buf):
  while i<len(buf) and buf[i].isspace(): i+=1
  if i>=len(buf):break
  try: o,i=dec.raw_decode(buf,i)
  except Exception: break
  ev=o.get('event') or {}
  req=ev.get('request') or {}
  h=req.get('headers') or {}
  url=req.get('url') or ('cron '+str(ev.get('cron')))
  ck=h.get('cookie','')
  login='L' if re.search(r'(yz_s|session|sid)=',ck) else '-'
  rsc='R' if h.get('rsc') else '-'
  ts=datetime.datetime.utcfromtimestamp(o['eventTimestamp']/1000).strftime('%H:%M:%S')
  st=(ev.get('response') or {}).get('status')
  rows.append((ts,o['outcome'],o.get('cpuTime'),o.get('wallTime'),st,login,rsc,req.get('method',''),re.sub(r'https://[^/]+','',url)[:90],h.get('user-agent','')[:25]))
for r in rows: print(*r,sep='\t')
