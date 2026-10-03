import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {PRODUCT_NAME, APP_ID, LINUX_EXECUTABLE} from '../main/brand.js';
import {WEBAPP_DIR, WEBAPP_FILES, globMatch, isWebappFile} from '../main/webfiles.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const pkg = read('package.json');
const configs = {win: read('electron-builder-win.json'), linux: read('electron-builder-linux.json')};

// What the run-only renderer loads (measured on a running project)
const LOADED = ['index.html', 'js/bootstrap.js', 'js/main.js', 'js/PreConfig.js', 'js/PostConfig.js', 'js/app.min.js',
	'js/extensions.min.js', 'js/stencils.min.js', 'js/shapes-14-6-5.min.js', 'js/plantuml/drawio-plantuml.min.js',
	'js/hmi/HmiRuntimeApp.js', 'js/diagramly/ElectronApp.js', 'js/diagramly/DesktopLibrary.js',
	'styles/grapheditor.css', 'css/hmi.css', 'mxgraph/css/common.css', 'images/spin.gif', 'resources/dia.txt',
	'math4/es5/startup.js'];

function packaged(files, file)
{
	let inc = false;

	for (const p of files)
	{
		if (p.startsWith('!'))
		{
			if (globMatch(p.slice(1), file)) inc = false;
		}
		else if (globMatch(p, file))
		{
			inc = true;
		}
	}

	return inc;
}

test('one identity everywhere', () =>
{
	assert.equal(pkg.productName, PRODUCT_NAME);

	for (const c of Object.values(configs))
	{
		assert.equal(c.productName, PRODUCT_NAME);
		assert.equal(c.appId, APP_ID);
		assert.equal(c.publish, null);
		assert.deepEqual(c.electronLanguages, ['en-US']);
	}

	assert.equal(configs.linux.linux.executableName, LINUX_EXECUTABLE);
});

test('the configs package exactly the web app files the server serves', () =>
{
	assert.deepEqual(configs.win.files, configs.linux.files);

	for (const f of WEBAPP_FILES)
	{
		assert.ok(configs.win.files.includes(WEBAPP_DIR + '/' + f), f);
	}

	assert.equal(configs.win.files.filter(f => f.startsWith(WEBAPP_DIR)).length, WEBAPP_FILES.length);
});

test('everything the runtime loads is served and packaged', () =>
{
	for (const f of LOADED)
	{
		assert.ok(isWebappFile(f), f);
		assert.ok(packaged(configs.win.files, WEBAPP_DIR + '/' + f), f);
		assert.ok(fs.existsSync(path.join(root, WEBAPP_DIR, f)), f + ' exists');
	}

	for (const f of ['LICENSE', 'NOTICE', 'src/main/main.js', 'src/main/server.js', 'src/web/bridge.js', 'src/launcher/index.html',
		'studio/package.json', 'studio/src/main/runtime/RuntimeMode.js', 'studio/src/main/comms/CommsSession.js',
		'studio/src/main/alarms/AlarmLog.js', 'studio/src/main/security/UserStore.js', 'studio/src/main/retentive/RetentiveStore.js',
		'studio/src/main/recipes/RecipeStore.js'])
	{
		assert.ok(packaged(configs.win.files, f), f);
	}
});

test('the editor and Studio\'s development features are left out', () =>
{
	for (const f of ['studio/src/main/electron.js', 'studio/src/main/publish/Publisher.js', 'studio/src/main/electron-preload.js',
		WEBAPP_DIR + '/js/integrate.min.js', WEBAPP_DIR + '/js/diagramly/Editor.js', WEBAPP_DIR + '/stencils/basic.xml',
		WEBAPP_DIR + '/templates/basic/cross.xml', WEBAPP_DIR + '/resources/dia_de.txt', WEBAPP_DIR + '/js/app.min.js.map',
		'src/test/server.test.js', 'scripts/dist-win.mjs'])
	{
		assert.ok(!packaged(configs.win.files, f), f);
	}

	assert.ok(!isWebappFile('js/app.min.js.map'));
	assert.ok(!isWebappFile('js/diagramly/Editor.js'));
});

test('the comms server and the icon ship as resources', () =>
{
	const res = (c) => Object.fromEntries(c.extraResources.map(r => [r.to, r.from]));
	assert.equal(res(configs.win).comms, 'studio/comms/publish/win-${arch}');
	assert.equal(res(configs.linux).comms, 'studio/comms/publish/linux-${arch}');
	assert.equal(res(configs.win)['icon.png'], 'build/icon.png');
});

test('run-time dependencies: electron-log and ws only', () =>
{
	assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['electron-log', 'ws']);
});

test('the test list names every test file', () =>
{
	const listed = pkg.scripts.test.split(' ').filter(a => a.endsWith('.test.js')).map(a => path.basename(a)).sort();
	const present = fs.readdirSync(path.join(root, 'src', 'test')).filter(f => f.endsWith('.test.js')).sort();
	assert.deepEqual(listed, present);
});
