// Shortcuts that start a project's web server, with its port and view.
//
// Windows: .lnk files (Electron's shell.writeShortcutLink) on the desktop and
// in Start menu > Programs > Append HMI Web.
// Linux: .desktop files on the desktop and in ~/.local/share/applications.
//
// Everything is per user, so no administrator rights are needed.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {PRODUCT_NAME, LINUX_EXECUTABLE} from './brand.js';

export const PLACES = ['desktop', 'menu'];

// The command that starts this app: an AppImage runs from a temporary mount,
// so its shortcuts must name the AppImage file itself; `electron .` needs the
// app folder after the Electron binary
export function launchCommand({execPath, appPath, defaultApp, env})
{
	if (env && env.APPIMAGE)
	{
		return {exe: env.APPIMAGE, args: []};
	}

	return defaultApp ? {exe: execPath, args: [appPath]} : {exe: execPath, args: []};
}

// Where shortcuts go
export function shortcutDirs({platform, home, appData, desktop, env = {}})
{
	if (platform === 'win32')
	{
		const programs = path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');

		return {
			desktop: desktop,
			menu: path.win32.join(programs, PRODUCT_NAME)
		};
	}

	const dataHome = env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share');

	return {
		desktop: desktop,
		menu: path.posix.join(dataHome, 'applications'),
		icons: path.posix.join(dataHome, 'icons')
	};
}

function pathHash(projectPath)
{
	return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 8);
}

export function windowsFileName(name)
{
	let s = String(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '').replace(/[. ]+$/, '').trim();

	if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s))
	{
		s = '_' + s;
	}

	return s.slice(0, 100) || 'HMI';
}

// Shortcut file names for a project, in order of preference. Windows shows
// the file name, so it is the project's name, qualified only if another
// project's shortcut already has it; Linux shows the entry's Name, so the file
// is named uniquely by the project's path
// What a project's shortcut is called
export function shortcutName(name)
{
	return name + ' (web)';
}

export function shortcutFileNames(platform, name, projectPath)
{
	name = shortcutName(name);

	if (platform === 'win32')
	{
		const base = windowsFileName(name);

		return [base + '.lnk', base + ' (' + pathHash(projectPath) + ').lnk'];
	}

	const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'hmi';

	return [LINUX_EXECUTABLE + '-' + slug + '-' + pathHash(projectPath) + '.desktop'];
}

// A Windows command-line argument
export function windowsQuote(arg)
{
	return /[\s"]/.test(arg) || arg === '' ? '"' + arg.replace(/"/g, '\\"') + '"' : arg;
}

// An Exec argument (Desktop Entry spec, "The Exec key")
export function execQuote(arg)
{
	const s = String(arg).replace(/%/g, '%%');

	return /[\s"'\\><~|&;$*?#()`]/.test(s) || s === '' ? '"' + s.replace(/(["`$\\])/g, '\\$1') + '"' : s;
}

// A string value in a .desktop file
function entryValue(s)
{
	return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}

export const PROJECT_KEY = 'X-AppendHMI-Project';

export function desktopEntry({name, command, args = [], projectPath, icon})
{
	const exec = [command.exe].concat(command.args, args, [projectPath]).map(execQuote).join(' ');
	const lines = [
		'[Desktop Entry]',
		'Type=Application',
		'Version=1.0',
		'Name=' + entryValue(shortcutName(name)),
		'Comment=' + entryValue('Serve ' + name + ' to web browsers with ' + PRODUCT_NAME),
		'Exec=' + entryValue(exec),
		'Terminal=false'
	];

	if (icon)
	{
		lines.push('Icon=' + entryValue(icon));
	}

	lines.push('Categories=Utility;');
	lines.push(PROJECT_KEY + '=' + entryValue(projectPath), '');

	return lines.join('\n');
}

// The project a .desktop file of ours runs, or null
export function desktopEntryProject(text)
{
	const m = new RegExp('^' + PROJECT_KEY + '=(.*)$', 'm').exec(text);

	return m ? m[1].replace(/\\(.)/g, (s, c) => ({s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\'}[c] ?? c)) : null;
}

// opts: platform, shell (Electron's; Windows), dirs (shortcutDirs), command
// (launchCommand), iconFile (the app icon .png, copied for Linux entries),
// trust(file) (Linux desktop files: marks them launchable, best effort)
export class Shortcuts
{
	constructor(opts)
	{
		this.opts = opts;
		this.win = opts.platform === 'win32';
	}

	// The shortcut in a place that runs this project, or null
	find(place, config)
	{
		const dir = this.opts.dirs[place];

		for (const name of shortcutFileNames(this.opts.platform, config.productName, config.projectPath))
		{
			const file = path.join(dir, name);

			if (fs.existsSync(file) && this.runs(file, config))
			{
				return file;
			}
		}

		return null;
	}

	runs(file, config)
	{
		try
		{
			if (this.win)
			{
				const link = this.opts.shell.readShortcutLink(file);

				return path.resolve(link.target).toLowerCase() === path.resolve(this.opts.command.exe).toLowerCase() &&
					link.args.toLowerCase().includes(config.projectPath.toLowerCase());
			}

			return desktopEntryProject(fs.readFileSync(file, 'utf8')) === config.projectPath;
		}
		catch (e)
		{
			return false;
		}
	}

	// Creates (or refreshes) the shortcut in a place, starting the server
	// with args (args.js serverArgs); returns its path
	create(place, config, args = [])
	{
		const dir = this.opts.dirs[place];
		fs.mkdirSync(dir, {recursive: true});

		const names = shortcutFileNames(this.opts.platform, config.productName, config.projectPath);
		// This project's own, else the first name no other project's uses
		const file = this.find(place, config) ||
			names.map(n => path.join(dir, n)).find(f => !fs.existsSync(f)) || path.join(dir, names[names.length - 1]);

		if (this.win)
		{
			const cmd = this.opts.command;
			// 'create' also overwrites; 'replace' fails when there is no shortcut yet
			const ok = this.opts.shell.writeShortcutLink(file, 'create', {
				target: cmd.exe,
				args: cmd.args.concat(args, [config.projectPath]).map(windowsQuote).join(' '),
				cwd: path.dirname(config.projectPath),
				description: 'Serve ' + config.productName + ' to web browsers with ' + PRODUCT_NAME,
				icon: cmd.exe,
				iconIndex: 0
			});

			if (!ok)
			{
				throw new Error('Windows could not create ' + file);
			}
		}
		else
		{
			fs.writeFileSync(file, desktopEntry({name: config.productName, command: this.opts.command, args: args,
				projectPath: config.projectPath, icon: this.linuxIcon()}), {mode: 0o755});
			fs.chmodSync(file, 0o755);

			if (place === 'desktop' && this.opts.trust)
			{
				this.opts.trust(file);
			}
		}

		return file;
	}

	// Removes this project's shortcut from a place; returns whether one went
	remove(place, config)
	{
		const file = this.find(place, config);

		if (file == null)
		{
			return false;
		}

		fs.rmSync(file, {force: true});

		return true;
	}

	// Linux entries point at a copy of the icon in the user's icon folder: the
	// AppImage's own files vanish when it exits
	linuxIcon()
	{
		const src = this.opts.iconFile;
		const dir = this.opts.dirs.icons;

		if (!src || !dir || !fs.existsSync(src))
		{
			return null;
		}

		const dest = path.join(dir, LINUX_EXECUTABLE + '.png');

		try
		{
			fs.mkdirSync(dir, {recursive: true});
			fs.copyFileSync(src, dest);

			return dest;
		}
		catch (e)
		{
			return null;
		}
	}
}
