import pathlib, shutil, subprocess, sys
source = pathlib.Path(__file__).resolve().parent
root = pathlib.Path('/tmp/flow-v2-server-probe')
root.mkdir(exist_ok=True)
for file in source.iterdir():
    if file.suffix in {'.mjs', '.ts', '.py'} and file.name != 'bootstrap.py':
        shutil.copyfile(file, root / file.name)
shutil.copyfile(source / 'package.json', root / 'package.json')
for name in ['workspace', 'config/opencode']:
    (root / name).mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'workspace.json', root / 'workspace/opencode.json')
shutil.copyfile(source / 'config.json', root / 'config/opencode/opencode.json')
subprocess.run([sys.executable, str(root / 'run-probe.py'), *sys.argv[1:]], check=True)
