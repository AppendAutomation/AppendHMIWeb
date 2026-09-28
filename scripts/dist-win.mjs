// Builds the Append HMI Web installer for Windows x64 on any host,
// without wine: electron-builder makes the unpacked app (--dir) and the
// bundled makensis compiles the installer (scripts/nsis.mjs).
//
//   node scripts/dist-win.mjs [--scope machine|user] [--compression small|fast]
//
// Output: dist/Append-HMI-Web-<version>-Setup.exe. Per-machine (Program
// Files, administrator) by default.

import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {buildWebNsis} from './nsis.mjs';
import {PRODUCT_NAME, PUBLISHER, WINDOWS_EXE} from '../src/main/brand.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, def) => (args.indexOf(name) >= 0) ? args[args.indexOf(name) + 1] : def;

const scope = arg('--scope', 'machine');
const compression = arg('--compression', 'small');

if (!['machine', 'user'].includes(scope) || !['small', 'fast'].includes(compression))
{
	console.error('Usage: node scripts/dist-win.mjs [--scope machine|user] [--compression small|fast]');
	process.exit(2);
}

function run(cmd, cmdArgs, env)
{
	const r = spawnSync(cmd, cmdArgs, {cwd: root, stdio: 'inherit', shell: process.platform == 'win32',
		env: Object.assign({}, process.env, env)});

	if (r.status !== 0)
	{
		process.exit(r.status ?? 1);
	}
}

const nsisDir = path.join(root, 'build', 'nsis', 'share');
const makensis = path.join(root, 'build', 'nsis', {win32: 'win', darwin: 'mac'}[process.platform] || 'linux',
	process.platform == 'win32' ? 'makensis.exe' : 'makensis');

if (!fs.existsSync(makensis))
{
	run(process.execPath, [path.join('scripts', 'fetch-nsis.mjs')]);
}

run(process.execPath, [path.join('studio', 'comms', 'scripts', 'publish.mjs'), '--rid', 'win-x64']);

const unpacked = path.join(root, 'dist', 'win-unpacked');
fs.rmSync(unpacked, {recursive: true, force: true});
run('npx', ['electron-builder', '--config', 'electron-builder-win.json', '--win', '--dir', '--x64',
	'--publish', 'never']);

for (const f of [WINDOWS_EXE, path.join('resources', 'comms', 'hmi-comms.exe'), path.join('resources', 'app.asar')])
{
	if (!fs.existsSync(path.join(unpacked, f)))
	{
		console.error('Missing from the Windows build: ' + f);
		process.exit(1);
	}
}

const entries = (dir) => fs.readdirSync(dir, {withFileTypes: true})
	.map(d => ({name: d.name, dir: d.isDirectory()}))
	.sort((a, b) => a.name.localeCompare(b.name));

const size = (p) =>
{
	const st = fs.lstatSync(p);

	return st.isDirectory() ? fs.readdirSync(p).reduce((t, n) => t + size(path.join(p, n)), 0) : st.size;
};

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const outFile = path.join(root, 'dist', 'Append-HMI-Web-' + version + (scope == 'user' ? '-user' : '') + '-Setup.exe');

const script = buildWebNsis({
	productName: PRODUCT_NAME,
	version: version,
	publisher: PUBLISHER,
	exeName: WINDOWS_EXE,
	scope: scope,
	compression: compression,
	outFile: outFile,
	appDir: unpacked,
	rootEntries: entries(unpacked),
	resources: entries(path.join(unpacked, 'resources')),
	firewallRule: PRODUCT_NAME,
	installerIcon: path.join(root, 'build', 'icon.ico'),
	join: path.join,
	estimatedSizeKb: size(unpacked) / 1024
});

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-nsis-'));

try
{
	const nsi = path.join(stage, 'installer.nsi');
	fs.writeFileSync(nsi, script);
	console.log('Compiling ' + path.relative(root, outFile) + ' (' + scope + ', ' + compression + ')');
	run(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', nsi], {NSISDIR: nsisDir});
}
finally
{
	fs.rmSync(stage, {recursive: true, force: true});
}

console.log('Windows installer -> ' + path.relative(root, outFile));
