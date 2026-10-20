import sys, re, json
from pathlib import Path
here = Path(__file__).parent
shell = (here/'src/shell.html').read_text(encoding='utf-8')
lib = (here/'vendor/sheetjs/xlsx.full.min.js').read_text(encoding='utf-8')
lib = lib.replace('"<!--"', '"\\x3c!--"')
version = json.loads((here/'package.json').read_text(encoding='utf-8'))['version']
shell = shell.replace('__VERSION__', version)
parts = {'SHEETJS': lib}
for k, f in [('CORE','core.js'),('LOGIC','logic.js'),('APP','app.js')]:
    parts[k] = (here/'src'/f).read_text(encoding='utf-8')
for k, v in parts.items():
    low = v.lower()
    assert '</script' not in low, k
    assert '<!--' not in v, k
    shell = shell.replace('/*__%s__*/' % k, v, 1)
assert '/*__' not in shell
out = Path(sys.argv[1]) if len(sys.argv) > 1 else here/'index.html'
out.write_text(shell, encoding='utf-8')
print(out, out.stat().st_size)
