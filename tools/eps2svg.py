import re, sys, struct
def convert(path, out):
    raw=open(path,'rb').read()
    mag, pso, psl = struct.unpack('<III', raw[:12])
    d = raw[pso:pso+psl].decode('latin1') if mag==0xc6d3d0c5 else raw.decode('latin1')
    bb = re.search(r'%%HiResBoundingBox: ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)', d)
    W=float(bb.group(3)); H=float(bb.group(4))
    i=d.find('%%EndPageSetup'); j=d.find('%%PageTrailer')
    toks=re.findall(r'\S+', d[i:j])
    st=[]; cur=[]; paths=[]; color='#000'
    def cmyk(c,m,y,k):
        r=255*(1-c)*(1-k); g=255*(1-m)*(1-k); b=255*(1-y)*(1-k)
        return '#%02x%02x%02x'%(round(r),round(g),round(b))
    skip_clip=True
    for t in toks:
        if re.match(r'^-?[\d.]+$', t): st.append(float(t)); continue
        if t=='mo': x,y=st[-2:]; cur.append(f'M{x:g} {y:g}'); st=[]
        elif t=='li': x,y=st[-2:]; cur.append(f'L{x:g} {y:g}'); st=[]
        elif t=='cv': a=st[-6:]; cur.append('C'+' '.join(f'{v:g}' for v in a)); st=[]
        elif t=='cp': cur.append('Z'); st=[]
        elif t=='cmyk': color=cmyk(*st[-4:]); st=[]
        elif t in ('gry',): color='#%02x%02x%02x'%((round(255*st[-1]),)*3); st=[]
        elif t in ('f','ef','@','s','S'):
            rule='evenodd' if t=='ef' else 'nonzero'
            if cur: paths.append((color,''.join(cur),rule,t in('@','s','S')))
            cur=[]; st=[]
        elif t=='clp': cur=[]; st=[]
        elif t=='np': cur=[]; st=[]
        else: st=[] if not t.startswith('[') else st
    out_s=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:g} {H:g}" width="{W:g}" height="{H:g}">']
    for col,p,rule,stroke in paths:
        if stroke: out_s.append(f'<path d="{p}" fill="none" stroke="{col}"/>')
        else: out_s.append(f'<path d="{p}" fill="{col}" fill-rule="{rule}"/>')
    out_s.append('</svg>')
    open(out,'w').write('\n'.join(out_s))
    return len(paths), W, H
for a in sys.argv[1:]:
    print(a, convert(a, '/tmp/eps/out/'+a.split('/')[-1][:8]+'.svg'))
