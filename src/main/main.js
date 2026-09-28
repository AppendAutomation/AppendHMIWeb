// Append HMI Web: serves Append HMI Studio applications to web browsers.
//
//   append-hmi-web [--port n] [--view v] [--local-only] project.ahmi
//                                       starts the project's web server
//   append-hmi-web --headless ... project.ahmi
//                                       the same, with no window
//   append-hmi-web                      opens the launcher window
//
// Each browser that opens the link runs the application through Append HMI
// Studio's run-only renderer, reaching this process over a WebSocket
// (src/web/bridge.js, server.js, rpc.js) for PLC data (hmi-comms), alarm
// history, retentive values and runtime user changes.

import fs from 'fs';
import path from 'path';
import url from 'url';
import {spawnSync} from 'child_process';
import {app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell} from 'electron';
import log from 'electron-log';
import {parseArgs, userArgs, serverArgs, validPort, VIEWS, USAGE} from './args.js';
import {loadProjectConfig, describe, isProjectFile} from './project.js';
import {Settings} from './settings.js';
import {Shortcuts, shortcutDirs, launchCommand} from './shortcuts.js';
import {serverLinks} from './network.js';
import {HmiWebServer} from './server.js';
import {AlarmEvents} from './rpc.js';
import {PRODUCT_NAME, HOMEPAGE_URL, DEFAULT_PORT} from './brand.js';
import {CommsSupervisor, resolveExecutable as resolveCommsExecutable} from
	'../../studio/src/main/comms/CommsSupervisor.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const __DEV__ = process.env.HMI_ENV === 'dev';
const isWin = process.platform === 'win32';

const argvOptions = (cwd) => ({defaultApp: process.defaultApp, appPath: path.resolve(app.getAppPath()),
	resolve: (a) => path.resolve(cwd, a)});
const args = parseArgs(userArgs(process.argv, argvOptions(process.cwd())));

log.transports.file.level = 'info';
log.transports.console.level = args.headless ? 'info' : 'warn';

if (args.help || args.version || args.error != null)
{
	if (args.error != null)
	{
		console.error(args.error + '\n\n' + USAGE);
	}
	else
	{
		console.log(args.help ? USAGE : PRODUCT_NAME + ' ' + app.getVersion());
	}

	process.exit(args.error != null ? 2 : 0);
}

if (args.disableAcceleration)
{
	app.disableHardwareAcceleration();
}

const codeDir = path.join(__dirname, '..', '..', 'studio', 'drawio', 'src', 'main', 'webapp');
const bridgeFile = path.join(__dirname, '..', 'web', 'bridge.js');
const launcherDir = path.join(__dirname, '..', 'launcher');
const launcherUrl = url.pathToFileURL(launcherDir).href.replace(/\/.:\//, s => s.toUpperCase());

const appIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') :
	path.join(__dirname, '..', '..', 'build', 'icon.png');

const shortcuts = new Shortcuts({
	platform: process.platform,
	shell: shell,
	dirs: shortcutDirs({platform: process.platform, home: app.getPath('home'), appData: app.getPath('appData'),
		desktop: app.getPath('desktop'), env: process.env}),
	command: launchCommand({execPath: process.execPath, appPath: app.getAppPath(),
		defaultApp: process.defaultApp, env: process.env}),
	iconFile: appIcon,
	trust: (file) =>
	{
		try
		{
			spawnSync('gio', ['set', file, 'metadata::trusted', 'true'], {timeout: 3000, stdio: 'ignore'});
		}
		catch (e) {}
	}
});

// Command-line options, else the project's last ones, else the defaults
function serverOptions(file, given = {})
{
	const saved = getSettings().serverOptions(file) || {};

	return {
		port: given.port ?? validPort(saved.port) ?? DEFAULT_PORT,
		view: given.view ?? (VIEWS.includes(saved.view) ? saved.view : 'fit'),
		localOnly: given.localOnly === true || (given.localOnly == null && saved.localOnly === true)
	};
}

if (args.createShortcut != null)
{
	app.whenReady().then(async () =>
	{
		try
		{
			const config = await loadProjectConfig(args.project);
			const opts = serverOptions(config.projectPath, {port: args.port, view: args.view,
				localOnly: args.localOnly || null});
			console.log('Created ' + shortcuts.create(args.createShortcut, config, serverArgs(opts)));
			app.exit(0);
		}
		catch (e)
		{
			console.error(e.message);
			app.exit(1);
		}
	});
}
else if (args.headless)
{
	// A server with no window, for a service or a terminal; stopped by
	// Ctrl+C, SIGTERM or the operating system
	app.whenReady().then(async () =>
	{
		try
		{
			const entry = await startServer(path.resolve(args.project), {port: args.port, view: args.view,
				localOnly: args.localOnly || null});
			console.log(PRODUCT_NAME + ' is serving ' + entry.config.productName + ':');

			for (const l of entry.links)
			{
				console.log('  ' + l.url + '   (' + l.label + ')');
			}
		}
		catch (e)
		{
			console.error(e.message);
			app.exit(1);
		}
	});
}
else if (!app.requestSingleInstanceLock())
{
	// The running instance starts the server (or shows the launcher)
	app.quit();
}
else
{
	app.on('second-instance', (event, argv, workingDirectory) =>
	{
		const again = parseArgs(userArgs(argv, argvOptions(workingDirectory || process.cwd())));
		showLauncher();

		if (again.project != null)
		{
			startFromCommandLine(path.resolve(workingDirectory || '.', again.project), again);
		}
	});

	app.whenReady().then(() =>
	{
		Menu.setApplicationMenu(null);
		showLauncher();

		if (args.project != null)
		{
			startFromCommandLine(path.resolve(args.project), args);
		}
	});
}

async function startFromCommandLine(file, a)
{
	allow(file);

	try
	{
		await startServer(file, {port: a.port, view: a.view, localOnly: a.localOnly || null});
	}
	catch (e)
	{
		log.error('Cannot serve ' + file + ': ' + e.message);
		notifyLauncher('launcher:error', e.message);
	}
}

// ------------------------------------------------------------------ settings

let settings = null;

function getSettings()
{
	if (settings == null)
	{
		settings = new Settings(app.getPath('userData'));
	}

	return settings;
}

// Paths the launcher may act on: picked in the OS dialog, given on the
// command line or already in the recent list
const allowedPaths = new Set();

function allow(file)
{
	allowedPaths.add(isWin ? file.toLowerCase() : file);
}

function isAllowed(file)
{
	const key = isWin ? file.toLowerCase() : file;

	return allowedPaths.has(key) || getSettings().recent.some(p => (isWin ? p.toLowerCase() : p) === key);
}

function samePath(a, b)
{
	return isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// ------------------------------------------------------------------ servers

// Running servers by port
const servers = new Map();

async function startServer(file, given)
{
	const config = await loadProjectConfig(file);
	const opts = serverOptions(config.projectPath, given);

	for (const s of servers.values())
	{
		if (samePath(s.config.projectPath, config.projectPath))
		{
			if (s.port === opts.port && s.view === opts.view && s.localOnly === opts.localOnly)
			{
				return s;
			}

			// New settings: the old server makes way
			await stopServer(s.port);
		}
	}

	if (servers.has(opts.port))
	{
		throw new Error('Port ' + opts.port + ' is already serving ' + servers.get(opts.port).config.productName +
			'. Choose another port.');
	}

	const server = new HmiWebServer({
		config: config,
		port: opts.port,
		host: opts.localOnly ? '127.0.0.1' : undefined,
		view: opts.view,
		webRoot: codeDir,
		bridgeFile: bridgeFile,
		shared: {base: app.getPath('userData'), supervisor: getCommsSupervisor, log: log,
			alarms: new AlarmEvents(), pruned: new Set()},
		log: log
	});

	await server.start();

	const entry = {port: opts.port, view: opts.view, localOnly: opts.localOnly, config: config, server: server,
		links: serverLinks({port: opts.port, localOnly: opts.localOnly})};
	servers.set(opts.port, entry);
	server.onChange(() => notifyLauncher());
	getSettings().setServerOptions(config.projectPath, opts);

	log.info('Serving ' + config.projectPath + ' on port ' + opts.port + (opts.localOnly ? ' (this computer only)' : '') +
		': ' + entry.links[0].url);
	notifyLauncher();

	return entry;
}

async function stopServer(port)
{
	const entry = servers.get(port);

	if (entry == null)
	{
		return false;
	}

	servers.delete(port);
	await entry.server.stop();
	log.info('Stopped serving ' + entry.config.productName + ' on port ' + port);
	notifyLauncher();

	return true;
}

function publicServers()
{
	return [...servers.values()].map(s => ({
		port: s.port,
		view: s.view,
		localOnly: s.localOnly,
		path: s.config.projectPath,
		name: s.config.productName,
		clients: s.server.clients,
		links: s.links
	}));
}

// ------------------------------------------------------------------ launcher

let launcher = null;
let quitting = false;

function notifyLauncher(channel = 'launcher:servers', data = publicServers())
{
	if (launcher != null && !launcher.isDestroyed())
	{
		launcher.webContents.send(channel, data);
	}
}

function showLauncher()
{
	if (launcher != null && !launcher.isDestroyed())
	{
		if (launcher.isMinimized()) launcher.restore();
		launcher.show();
		launcher.focus();

		return;
	}

	launcher = new BrowserWindow({
		width: 680,
		height: 720,
		minWidth: 560,
		minHeight: 560,
		title: PRODUCT_NAME,
		icon: isWin ? undefined : appIcon,
		show: false,
		autoHideMenuBar: true,
		backgroundColor: '#f4f5f7',
		webPreferences: {
			preload: path.join(__dirname, 'launcher-preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false
		}
	});

	launcher.loadFile(path.join(launcherDir, 'index.html'));
	launcher.once('ready-to-show', () => launcher.show());

	// Closing the window stops the servers, after asking
	launcher.on('close', (e) =>
	{
		if (quitting || servers.size === 0)
		{
			return;
		}

		const names = [...servers.values()].map(s => s.config.productName).join(', ');
		const choice = dialog.showMessageBoxSync(launcher, {
			type: 'question',
			buttons: ['Stop and close', 'Cancel'],
			defaultId: 1,
			cancelId: 1,
			title: PRODUCT_NAME,
			message: 'Stop the web server?',
			detail: 'Browsers showing ' + names + ' will lose their connection.'
		});

		if (choice !== 0)
		{
			e.preventDefault();
		}
	});

	launcher.on('closed', () =>
	{
		launcher = null;
		app.quit();
	});

	if (__DEV__)
	{
		launcher.webContents.openDevTools({mode: 'detach'});
	}
}

function launcherRequest(channel, fn)
{
	ipcMain.handle(channel, async (event, ...params) =>
	{
		const frame = event.senderFrame;

		if (frame == null || !frame.url.replace(/\/.:\//, s => s.toUpperCase()).startsWith(launcherUrl))
		{
			throw new Error('refused');
		}

		return fn(...params);
	});
}

function checkedPath(file)
{
	if (typeof file !== 'string' || !isProjectFile(file) || !isAllowed(file))
	{
		throw new Error('Choose the project with Browse first.');
	}

	return file;
}

function checkedOptions(o)
{
	const port = validPort(o && o.port);

	if (port == null)
	{
		throw new Error('The port must be a number from 1 to 65535.');
	}

	return {port: port, view: VIEWS.includes(o.view) ? o.view : 'fit', localOnly: o.localOnly === true};
}

async function projectInfo(file)
{
	try
	{
		const config = await loadProjectConfig(file);

		return Object.assign(describe(config), {
			options: serverOptions(config.projectPath),
			desktop: shortcuts.find('desktop', config) != null,
			menu: shortcuts.find('menu', config) != null
		});
	}
	catch (e)
	{
		return {path: file, name: path.basename(file), error: e.message, options: serverOptions(file)};
	}
}

launcherRequest('launcher:state', async () => ({
	product: PRODUCT_NAME,
	version: app.getVersion(),
	platform: process.platform,
	homepage: HOMEPAGE_URL,
	defaultPort: DEFAULT_PORT,
	servers: publicServers(),
	recent: getSettings().recent.map(p => ({path: p, name: path.basename(p), exists: fs.existsSync(p)}))
}));

launcherRequest('launcher:browse', async () =>
{
	const res = await dialog.showOpenDialog(launcher, {
		title: 'Choose an HMI application',
		properties: ['openFile'],
		filters: [{name: 'HMI applications', extensions: ['ahmi', 'drawio-hmi']}]
	});

	if (res.canceled || res.filePaths.length === 0)
	{
		return null;
	}

	allow(res.filePaths[0]);

	return projectInfo(res.filePaths[0]);
});

launcherRequest('launcher:info', async (file) => projectInfo(checkedPath(file)));

launcherRequest('launcher:start', async (file, options) =>
{
	const entry = await startServer(checkedPath(file), checkedOptions(options));

	return publicServers().find(s => s.port === entry.port);
});

launcherRequest('launcher:stop', async (port) => stopServer(Number(port)));

launcherRequest('launcher:shortcut', async (file, place, options) =>
{
	if (place !== 'desktop' && place !== 'menu')
	{
		throw new Error('bad place');
	}

	const config = await loadProjectConfig(checkedPath(file));
	const opts = checkedOptions(options);
	const created = shortcuts.create(place, config, serverArgs(opts));
	log.info('Created shortcut ' + created);
	getSettings().setServerOptions(config.projectPath, opts);

	return created;
});

// Only links of running servers are copied or opened
function servedLink(link)
{
	return [...servers.values()].some(s => s.links.some(l => l.url === link));
}

launcherRequest('launcher:copy', async (link) =>
{
	if (!servedLink(link))
	{
		throw new Error('Not a link of a running server');
	}

	clipboard.writeText(link);

	return true;
});

launcherRequest('launcher:open', async (link) =>
{
	if (!servedLink(link))
	{
		throw new Error('Not a link of a running server');
	}

	await shell.openExternal(link);

	return true;
});

launcherRequest('launcher:forget', async (file) =>
{
	getSettings().removeRecent(file);

	return true;
});

// ------------------------------------------------------------------ comms

let commsSupervisor = null;

function getCommsSupervisor()
{
	if (commsSupervisor == null)
	{
		commsSupervisor = new CommsSupervisor({
			executable: resolveCommsExecutable({isPackaged: app.isPackaged, resourcesPath: process.resourcesPath,
				appPath: path.join(app.getAppPath(), 'studio')}),
			extractDir: path.join(app.getPath('userData'), 'comms-cache')
		});

		commsSupervisor.on('log', (line) => log.info('[hmi-comms] ' + line));
		commsSupervisor.on('exit', (e) =>
		{
			if (!e.expected)
			{
				log.warn('[hmi-comms] exited unexpectedly', e.code, e.signal);
			}
		});
		commsSupervisor.on('failed', (e) => log.error('[hmi-comms]', e.message));
	}

	return commsSupervisor;
}

// ------------------------------------------------------------------ lifetime

// Headless there is no window; otherwise closing the launcher quits
app.on('window-all-closed', () =>
{
	if (!args.headless)
	{
		app.quit();
	}
});

app.on('before-quit', () =>
{
	quitting = true;
});

app.on('will-quit', (e) =>
{
	if (servers.size > 0)
	{
		// Browsers are told the server went away before the process ends
		e.preventDefault();
		Promise.all([...servers.keys()].map(stopServer)).finally(() =>
		{
			if (commsSupervisor != null)
			{
				commsSupervisor.stop();
			}

			app.exit(0);
		});

		return;
	}

	if (commsSupervisor != null)
	{
		commsSupervisor.stop();
	}
});
