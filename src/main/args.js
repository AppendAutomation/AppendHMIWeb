// Command line:
//
//   append-hmi-web [options] [project.ahmi]
//
// With a project it serves it; without one it opens the launcher window.

import {DEFAULT_PORT} from './brand.js';

export const VIEWS = ['fit', 'fill', 'original'];
export const SHORTCUT_PLACES = ['desktop', 'menu'];

export const USAGE = `Usage: append-hmi-web [options] [project.ahmi]

Serves an Append HMI Studio application to web browsers. Without a project,
opens the launcher window.

Options:
  --port <n>                 Web server port (default ${DEFAULT_PORT}).
  --view <fit|fill|original> How browsers show the screen at first: fit to the
                             window, fill (maximize) it, or original size.
                             Default fit; each browser can change it.
  --local-only               Only this computer can connect (127.0.0.1).
  --headless                 No window: print the link and serve until stopped
                             (the launcher's Running list can stop it).
  --create-shortcut <where>  Create a shortcut that starts the web server with
                             these options, then exit. <where> is desktop or menu.
  --disable-acceleration     Turn off GPU acceleration.
  -h, --help                 Show this help.
  -v, --version              Show the version.`;

// Switches Electron or Chromium take themselves, passed through untouched
const PASSTHROUGH = [/^--no-sandbox$/, /^--disable-gpu/, /^--enable-logging/, /^--v=/,
	/^--remote-debugging-port=/, /^--inspect/, /^--ozone-platform/, /^--enable-features=/,
	/^--disable-features=/, /^--lang=/, /^--force-device-scale-factor=/, /^--allow-file-access/];

export function validPort(v)
{
	const n = Number(v);

	return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// argv without the executable (see userArgs). Returns {project, port, view,
// localOnly, headless, createShortcut, help, version, disableAcceleration,
// error}; port and view are null when not given.
export function parseArgs(argv)
{
	const res = {project: null, port: null, view: null, localOnly: false, headless: false, createShortcut: null,
		help: false, version: false, disableAcceleration: false, error: null};
	const fail = (msg) =>
	{
		if (res.error == null) res.error = msg;
	};
	const value = (a, i) => a.includes('=') ? {v: a.slice(a.indexOf('=') + 1), i: i} : {v: argv[i + 1], i: i + 1};

	for (let i = 0; i < argv.length; i++)
	{
		const a = argv[i];

		if (typeof a !== 'string' || a === '')
		{
			continue;
		}

		const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;

		switch (name)
		{
			case '-h':
			case '--help':
				res.help = true;
				break;
			case '-v':
			case '--version':
				res.version = true;
				break;
			case '--disable-acceleration':
				res.disableAcceleration = true;
				break;
			case '--local-only':
				res.localOnly = true;
				break;
			case '--headless':
				res.headless = true;
				break;
			case '--port':
			{
				const r = value(a, i);
				i = r.i;
				res.port = validPort(r.v);

				if (res.port == null)
				{
					fail('--port needs a number from 1 to 65535');
				}

				break;
			}
			case '--view':
			{
				const r = value(a, i);
				i = r.i;

				if (!VIEWS.includes(r.v))
				{
					fail('--view needs one of: ' + VIEWS.join(', '));
				}

				res.view = r.v;
				break;
			}
			case '--create-shortcut':
			{
				const r = value(a, i);
				i = r.i;

				if (!SHORTCUT_PLACES.includes(r.v))
				{
					fail('--create-shortcut needs one of: ' + SHORTCUT_PLACES.join(', '));
				}

				res.createShortcut = r.v;
				break;
			}
			default:
				if (a.startsWith('-'))
				{
					if (!PASSTHROUGH.some(r => r.test(a)))
					{
						fail('Unknown option: ' + a);
					}
				}
				else if (res.project == null)
				{
					res.project = a;
				}
				else
				{
					fail('Only one project can be given');
				}
		}
	}

	if ((res.createShortcut != null || res.headless) && res.project == null)
	{
		fail((res.headless ? '--headless' : '--create-shortcut') + ' needs a project');
	}

	return res;
}

// The command-line options that reproduce a server's settings, for shortcuts
export function serverArgs({port, view, localOnly})
{
	const out = ['--port', String(port)];

	if (view != null && view !== 'fit')
	{
		out.push('--view', view);
	}

	if (localOnly)
	{
		out.push('--local-only');
	}

	return out;
}

// The user's arguments from an argv (process.argv, or a second instance's):
// argv[0] is the executable, and for `electron .` (defaultApp) the app folder
// is among the arguments too. A second instance's argv comes reordered, with
// the switches first, so the app folder is found by where it points, not by
// its position. resolve(arg) gives an argument's absolute path.
export function userArgs(argv, {defaultApp, appPath, resolve})
{
	const rest = argv.slice(1);

	if (defaultApp)
	{
		const i = rest.findIndex(a => typeof a === 'string' && !a.startsWith('-') && resolve(a) === appPath);

		if (i >= 0)
		{
			rest.splice(i, 1);
		}
	}

	return rest;
}
