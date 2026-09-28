import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {launchCommand, shortcutDirs, shortcutFileNames, execQuote, windowsQuote, desktopEntry,
	desktopEntryProject, Shortcuts} from '../main/shortcuts.js';

test('the launch command', () =>
{
	assert.deepEqual(launchCommand({execPath: '/opt/a/app', appPath: '/x', defaultApp: false, env: {}}),
		{exe: '/opt/a/app', args: []});
	assert.deepEqual(launchCommand({execPath: '/tmp/.mount/app', appPath: '/x', defaultApp: false,
		env: {APPIMAGE: '/home/u/App.AppImage'}}), {exe: '/home/u/App.AppImage', args: []});
	assert.deepEqual(launchCommand({execPath: '/e/electron', appPath: '/src', defaultApp: true, env: {}}),
		{exe: '/e/electron', args: ['/src']});
});

test('shortcut folders', () =>
{
	const w = shortcutDirs({platform: 'win32', home: 'C:\\Users\\op', appData: 'C:\\Users\\op\\AppData\\Roaming',
		desktop: 'C:\\Users\\op\\Desktop'});
	assert.equal(w.menu, 'C:\\Users\\op\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Append HMI Web');
	assert.equal(w.startup, undefined);

	const l = shortcutDirs({platform: 'linux', home: '/home/op', desktop: '/home/op/Desktop', env: {}});
	assert.equal(l.menu, '/home/op/.local/share/applications');
	assert.equal(shortcutDirs({platform: 'linux', home: '/h', desktop: '/h/D',
		env: {XDG_DATA_HOME: '/data'}}).menu, '/data/applications');
});

test('file names', () =>
{
	const [first, second] = shortcutFileNames('win32', 'Line: 3', 'C:\\p\\Line 3.ahmi');
	assert.equal(first, 'Line 3 (web).lnk');
	assert.match(second, /^Line 3 \(web\) \([0-9a-f]{8}\)\.lnk$/);
	assert.match(shortcutFileNames('linux', 'Line 3', '/p/Line 3.ahmi')[0], /^append-hmi-web-line-3-web-[0-9a-f]{8}\.desktop$/);
	assert.notEqual(shortcutFileNames('linux', 'A', '/p/A.ahmi')[0], shortcutFileNames('linux', 'A', '/q/A.ahmi')[0]);
});

test('quoting', () =>
{
	assert.equal(windowsQuote('C:\\My Plant\\a.ahmi'), '"C:\\My Plant\\a.ahmi"');
	assert.equal(windowsQuote('C:\\p\\a.ahmi'), 'C:\\p\\a.ahmi');
	assert.equal(execQuote('/home/u/a.ahmi'), '/home/u/a.ahmi');
	assert.equal(execQuote('/home/u/My Plant/a$1.ahmi'), '"/home/u/My Plant/a\\$1.ahmi"');
	assert.equal(execQuote('/p/100%.ahmi'), '/p/100%%.ahmi');
});

test('a desktop entry names its project', () =>
{
	const text = desktopEntry({name: 'Line 3', command: {exe: '/opt/App Dir/app', args: []}, args: ['--port', '9000'],
		projectPath: '/home/u/My Plant/Line 3.ahmi', icon: '/i.png'});
	assert.match(text, /^\[Desktop Entry\]\nType=Application\n/);
	assert.match(text, /\nName=Line 3 \(web\)\n/);
	assert.match(text, /\nExec="\/opt\/App Dir\/app" --port 9000 "\/home\/u\/My Plant\/Line 3.ahmi"\n/);
	assert.equal(desktopEntryProject(text), '/home/u/My Plant/Line 3.ahmi');
	assert.match(desktopEntry({name: 'X', command: {exe: '/a', args: []}, projectPath: '/x.ahmi'}), /\nCategories=Utility;\n/);
});

test('Linux shortcuts and menu entries', () =>
{
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-home-'));

	try
	{
		const icon = path.join(home, 'icon.png');
		fs.writeFileSync(icon, 'png');
		const trusted = [];
		const s = new Shortcuts({platform: 'linux', dirs: shortcutDirs({platform: 'linux', home: home,
			desktop: path.join(home, 'Desktop'), env: {}}), command: {exe: '/opt/app/app', args: []},
			iconFile: icon, trust: (f) => trusted.push(f)});
		const config = {productName: 'Line 3', projectPath: '/plant/Line 3.ahmi'};
		const other = {productName: 'Line 3', projectPath: '/other/Line 3.ahmi'};

		const desktop = s.create('desktop', config);
		assert.equal(fs.statSync(desktop).mode & 0o777, 0o755);
		assert.deepEqual(trusted, [desktop]);
		assert.match(fs.readFileSync(desktop, 'utf8'), new RegExp('Icon=' + home + '/.local/share/icons/append-hmi-web.png'));
		assert.equal(s.find('desktop', config), desktop);
		assert.equal(s.find('desktop', other), null);
		assert.equal(s.create('desktop', config), desktop, 'created again in place');

		s.create('menu', config);
		assert.ok(s.find('menu', config).startsWith(path.join(home, '.local', 'share', 'applications')));

		const withPort = s.create('menu', config, ['--port', '9000']);
		assert.match(fs.readFileSync(withPort, 'utf8'), /--port 9000/);
		assert.equal(s.remove('menu', config), true);
		assert.equal(s.find('menu', config), null);
	}
	finally
	{
		fs.rmSync(home, {recursive: true, force: true});
	}
});

test('Windows shortcuts go through the shell, and another project keeps its name', () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-win-'));
	const links = new Map();
	const shell = {
		writeShortcutLink: (file, op, opts) =>
		{
			// Electron's 'replace' fails for a shortcut that does not exist yet
			if (op !== 'create') return false;

			links.set(file, opts);
			fs.writeFileSync(file, 'lnk');

			return true;
		},
		readShortcutLink: (file) => links.get(file)
	};

	try
	{
		const s = new Shortcuts({platform: 'win32', shell: shell, dirs: {desktop: dir, menu: dir, startup: dir},
			command: {exe: 'C:\\Program Files\\Append HMI Web\\Append HMI Web.exe', args: []}});
		const a = {productName: 'Line 3', projectPath: 'C:\\Plant A\\Line 3.ahmi'};
		const b = {productName: 'Line 3', projectPath: 'C:\\Plant B\\Line 3.ahmi'};

		const fa = s.create('desktop', a, ['--port', '9000']);
		assert.equal(path.dirname(fa), dir);
		assert.equal(path.basename(fa), 'Line 3 (web).lnk');
		const link = links.get(fa);
		assert.equal(link.target, 'C:\\Program Files\\Append HMI Web\\Append HMI Web.exe');
		assert.equal(link.args, '--port 9000 "C:\\Plant A\\Line 3.ahmi"');
		assert.equal(link.description, 'Serve Line 3 to web browsers with Append HMI Web');
		assert.equal(link.icon, link.target);
		assert.equal(link.iconIndex, 0);

		const fb = s.create('desktop', b);
		assert.notEqual(fb, fa);
		assert.equal(s.find('desktop', a), fa);
		assert.equal(s.find('desktop', b), fb);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
