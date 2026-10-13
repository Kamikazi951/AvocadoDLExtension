"""Package only extension runtime files, icons and installation instructions."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
output = root.parent / ('avocadodl-chrome-extension-v' + manifest['version'] + '.zip')
files = [path for path in root.iterdir() if path.suffix in ('.js', '.html', '.css')]
files += [root / 'manifest.json', root / 'README.md', root / 'CHANGELOG.md']
files += list((root / 'icons').glob('*.png'))
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, path.relative_to(root).as_posix())
print(output)
