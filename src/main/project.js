// Reads a project's name and screen size from its .ahmi file. The result has
// the shape Studio's run-only mode uses (studio/src/main/runtime/
// RuntimeMode.js), so its project reader and runtime info apply unchanged.
// The window mode and exit policy are the desktop's: a browser tab has
// neither, so they are read but never enforced here.

import fs from 'fs';
import path from 'path';

export const EXTENSIONS = ['.ahmi', '.drawio-hmi'];
export const WINDOW_MODES = ['kiosk', 'fullscreen', 'window'];
export const EXIT_MODES = ['shortcut', 'password', 'never'];

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;

export function isProjectFile(file)
{
	return typeof file === 'string' && EXTENSIONS.some(e => file.toLowerCase().endsWith(e));
}

// The project's display name: its file name without the extension
export function projectName(file)
{
	let base = path.basename(file);
	const ext = EXTENSIONS.find(e => base.toLowerCase().endsWith(e));

	if (ext != null)
	{
		base = base.slice(0, base.length - ext.length);
	}

	return base.replace(/[\x00-\x1f<>:"/\\|?*]/g, '').trim().slice(0, 100) || 'HMI';
}

function decodeXml(s)
{
	return s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
	{
		switch (e.toLowerCase())
		{
			case 'lt': return '<';
			case 'gt': return '>';
			case 'quot': return '"';
			case 'apos': return '\'';
			case 'amp': return '&';
		}

		return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
	});
}

// The attributes of the first <name ...> element in xml, or null
export function elementAttributes(xml, name)
{
	const m = new RegExp('<' + name + '(\\s[^>]*?)?/?>').exec(xml);

	if (m == null)
	{
		return null;
	}

	const attrs = {};
	const re = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
	let a;

	while ((a = re.exec(m[1] || '')) != null)
	{
		attrs[a[1]] = decodeXml(a[3] != null ? a[3] : a[4]);
	}

	return attrs;
}

function dimension(v, def)
{
	v = Number(v);

	return Number.isInteger(v) && v >= 320 && v <= 16384 ? v : def;
}

// The run settings in a project's XML. Throws with a readable reason.
export function parseProjectConfig(xml, projectPath)
{
	const start = xml.indexOf('<hmiProject');
	const end = xml.indexOf('</hmiProject>', start);

	if (start < 0 || end < 0)
	{
		throw new Error(path.basename(projectPath) + ' is not an Append HMI Studio project.');
	}

	const block = xml.slice(start, end);
	const settings = elementAttributes(block, 'settings') || {};
	const runtime = elementAttributes(block, 'runtime') || {};
	const exitMode = EXIT_MODES.includes(runtime.exit) ? runtime.exit : 'shortcut';
	const hash = String(runtime.hash || '').toLowerCase();

	return {
		dir: path.dirname(projectPath),
		projectPath: projectPath,
		productName: projectName(projectPath),
		version: '',
		iconPath: null,
		windowMode: WINDOW_MODES.includes(runtime.windowMode) ? runtime.windowMode : 'kiosk',
		width: dimension(settings.width, 1024),
		height: dimension(settings.height, 768),
		exit: {mode: exitMode, salt: runtime.salt || '', hash: exitMode === 'password' && /^[0-9a-f]{64}$/.test(hash) ? hash : null}
	};
}

// Reads and checks a project file. Throws with a readable reason.
export async function loadProjectConfig(file)
{
	if (!isProjectFile(file))
	{
		throw new Error('Not an HMI project (.ahmi): ' + file);
	}

	const projectPath = path.resolve(file);
	let stat;

	try
	{
		stat = await fs.promises.stat(projectPath);
	}
	catch (e)
	{
		throw new Error('Cannot find ' + projectPath);
	}

	if (!stat.isFile() || stat.size > MAX_PROJECT_BYTES)
	{
		throw new Error('Not a usable project file: ' + projectPath);
	}

	return parseProjectConfig(await fs.promises.readFile(projectPath, 'utf8'), projectPath);
}

// What the launcher shows about a project
export function describe(config)
{
	return {
		path: config.projectPath,
		name: config.productName,
		width: config.width,
		height: config.height
	};
}
