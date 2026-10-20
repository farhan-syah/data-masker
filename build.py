import os, sys, re
from pathlib import Path
here = Path(__file__).parent
shell = (here/'src/shell.html').read_text(encoding='utf-8')
lib = (here/'vendor/sheetjs/xlsx.full.min.js').read_text(encoding='utf-8')
lib = lib.replace('"<!--"', '"\\x3c!--"')
# The version comes from the release tag. A release build sets DM_VERSION (for example 1.2.3). Any other build is a development build.
version = os.environ.get('DM_VERSION', '').lstrip('v')
assert not version or re.fullmatch(r'\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?', version), 'DM_VERSION must look like 1.2.3'
shell = shell.replace('__VERSION__', 'v' + version if version else 'development build')
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
