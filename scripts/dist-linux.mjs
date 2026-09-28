// Builds the Append HMI Web Linux packages (AppImage and deb, x64): the
// comms server, then electron-builder.
//
//   node scripts/dist-linux.mjs
//
// Output in dist/.

import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, cmdArgs)
{
	const r = spawnSync(cmd, cmdArgs, {cwd: root, stdio: 'inherit', shell: process.platform == 'win32'});

	if (r.status !== 0)
	{
		process.exit(r.status ?? 1);
	}
}

run(process.execPath, [path.join('studio', 'comms', 'scripts', 'publish.mjs'), '--rid', 'linux-x64']);
run('npx', ['electron-builder', '--config', 'electron-builder-linux.json', '--linux', '--x64', '--publish', 'never']);
