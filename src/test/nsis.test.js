import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
import {buildWebNsis} from '../../scripts/nsis.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function script(overrides = {})
{
	return buildWebNsis(Object.assign({
		productName: 'Append HMI Web',
		version: '1.2.3',
		publisher: 'Append Automation',
		exeName: 'Append HMI Web.exe',
		scope: 'machine',
		compression: 'fast',
		outFile: '/out/Setup.exe',
		appDir: '/app',
		rootEntries: [{name: 'Append HMI Web.exe', dir: false}, {name: 'locales', dir: true}, {name: 'resources', dir: true}],
		resources: [{name: 'app.asar', dir: false}, {name: 'comms', dir: true}],
		firewallRule: 'Append HMI Web',
		installerIcon: null,
		join: path.posix.join,
		estimatedSizeKb: 1000
	}, overrides));
}

test('per machine: Program Files, admin, a firewall rule for private and domain networks', () =>
{
	const s = script();
	assert.match(s, /RequestExecutionLevel admin/);
	assert.match(s, /InstallDir "\$PROGRAMFILES64\\Append HMI Web"/);
	assert.match(s, /netsh advfirewall firewall add rule name="Append HMI Web" dir=in action=allow program="\$INSTDIR\\\$\{EXE\}" enable=yes profile=private,domain'/);
	assert.ok(s.indexOf('firewall delete rule') < s.indexOf('firewall add rule'), 'replaced on upgrade');
	assert.doesNotMatch(s, /profile=[^'\n]*public/);
	assert.match(s, /Section "Uninstall"[\s\S]*netsh advfirewall firewall delete rule name="Append HMI Web"/);
});

test('per user: no admin and no firewall rule', () =>
{
	const s = script({scope: 'user'});
	assert.match(s, /RequestExecutionLevel user/);
	assert.doesNotMatch(s, /netsh/);
	assert.doesNotMatch(s, /HKLM/);
});

test('no file association', () =>
{
	assert.doesNotMatch(script(), /Software\\Classes/);
});

test('a running copy is stopped before files are replaced', () =>
{
	const s = script();
	assert.ok(s.indexOf('!insertmacro StopApp') < s.indexOf('RMDir /r "$INSTDIR\\resources"'));
});

test('makensis compiles it', {skip: !fs.existsSync(path.join(root, 'build', 'nsis', 'linux', 'makensis')) ||
	process.platform !== 'linux'}, () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-nsis-'));

	try
	{
		const app = path.join(dir, 'app');
		fs.mkdirSync(path.join(app, 'resources', 'comms'), {recursive: true});
		fs.mkdirSync(path.join(app, 'locales'));
		fs.writeFileSync(path.join(app, 'Append HMI Web.exe'), 'exe');
		fs.writeFileSync(path.join(app, 'locales', 'en-US.pak'), 'pak');
		fs.writeFileSync(path.join(app, 'resources', 'app.asar'), 'asar');
		fs.writeFileSync(path.join(app, 'resources', 'comms', 'hmi-comms.exe'), 'comms');

		const out = path.join(dir, 'Setup.exe');
		const nsi = path.join(dir, 'installer.nsi');
		fs.writeFileSync(nsi, script({appDir: app, outFile: out, join: path.join, installerIcon: path.join(root, 'build', 'icon.ico')}));

		const r = spawnSync(path.join(root, 'build', 'nsis', 'linux', 'makensis'), ['-V2', '-INPUTCHARSET', 'UTF8', nsi],
			{env: Object.assign({}, process.env, {NSISDIR: path.join(root, 'build', 'nsis', 'share')}), encoding: 'utf8'});
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.ok(fs.statSync(out).size > 10000);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
