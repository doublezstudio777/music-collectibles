# 找按鈕／操作連結上只有一個中文字的文字（2026-09-29 用字與版本欄）
# 做法：逐一找 <button|Link|a|summary|任何 className 含 btn/pick 的元素>，大括號感知地切出開頭標籤，
# 取到對應結尾標籤的內文，去掉子標籤，運算式裡的字串常值逐一展開成各種可能的顯示文字；
# 另外掃 action／saveLabel／cancelLabel／label 屬性與 ["key","字"] 選項陣列。
import re, sys, pathlib
root = pathlib.Path(sys.argv[1])
HAN = r'[一-鿿]'
one = re.compile(rf'^\s*{HAN}\s*(…|\.\.\.)?\s*$')
lit_re = re.compile(r'"([^"\n]*)"|\'([^\'\n]*)\'|`([^`\n]*)`')

def open_end(t, i):
    depth = 0; q = None; j = i
    while j < len(t):
        c = t[j]
        if q:
            if c == q and t[j-1] != '\\': q = None
        elif c in '"\'`' and depth > 0: q = c
        elif c == '{': depth += 1
        elif c == '}': depth -= 1
        elif c == '>' and depth == 0: return j
        j += 1
    return -1

def variants(body):
    out = ['']
    i = 0
    while i < len(body):
        if body[i] == '{':
            d = 0; j = i
            while j < len(body):
                if body[j] == '{': d += 1
                elif body[j] == '}':
                    d -= 1
                    if d == 0: break
                j += 1
            exp = body[i+1:j]
            lits = [next((x for x in g if x), '') for g in lit_re.findall(exp)] or ['#']
            lits = lits[:6]
            out = [o + l for o in out for l in lits][:200]
            i = j + 1
        else:
            out = [o + body[i] for o in out]; i += 1
    return out

hits = set()
for f in sorted(list(root.rglob('*.tsx')) + list(root.rglob('*.ts'))):
    s = str(f)
    if '/ui/' in s or 'node_modules' in s or '/dist/' in s or '/.' in s or '/scripts/' in s: continue
    t = f.read_text(encoding='utf-8')
    for m in re.finditer(r'<([A-Za-z]+)\b', t):
        tag = m.group(1)
        e = open_end(t, m.end())
        if e < 0 or t[e-1] == '/': continue
        head = t[m.start():e]
        if not (tag in ('button', 'Link', 'a', 'summary') or re.search(r'className="[^"]*\b(btn|pick|sf-change)', head)): continue
        close = t.find(f'</{tag}>', e)
        if close < 0: continue
        inner = t[e+1:close]
        if f'<{tag}' in inner: continue  # 巢狀同名元素，略過
        body = re.sub(r'<[^{}>]*?/?>', '', inner)
        for v in variants(body):
            v = re.sub(r'\s+', '', v)
            if one.match(v): hits.add((s, t[:m.start()].count('\n') + 1, tag, v))
    for m in re.finditer(r'\b(action|saveLabel|cancelLabel|label|confirmLabel|okLabel)=(?:"([^"]*)"|\{([^{}]*)\})', t):
        vals = [m.group(2)] if m.group(2) is not None else [next((x for x in g if x), '') for g in lit_re.findall(m.group(3))]
        for v in vals:
            if one.match(v): hits.add((s, t[:m.start()].count('\n') + 1, m.group(1), v))
    for m in re.finditer(rf'\[\s*"[A-Za-z_-]+"\s*,\s*"({HAN})"\s*\]', t):
        hits.add((s, t[:m.start()].count('\n') + 1, 'tuple', m.group(1)))
for h in sorted(hits): print(*h, sep=' | ')
print('TOTAL', len(hits))
