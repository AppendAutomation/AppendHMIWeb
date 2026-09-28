import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
import WebSocket from 'ws';
import {HmiWebServer, webappPath, pageQuery, WS_PATH} from '../main/server.js';
import {AlarmEvents} from '../main/rpc.js';
import {parseProjectConfig} from '../main/project.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webRoot = path.join(root, 'studio', 'drawio', 'src', 'main', 'webapp');
const quiet = {info() {}, warn() {}, error() {}};
let dir, server, port;

function get(p, headers = {}, method = 'GET')
{
	return new Promise((resolve, reject) =>
	{
		const req = http.request({host: '127.0.0.1', port: port, path: p, method: method, headers: headers}, (res) =>
		{
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
		});
		req.on('error', reject);
		req.end();
	});
}

before(async () =>
{
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-server-'));
	const file = path.join(dir, 'Pumps.ahmi');
	const xml = '<mxfile hmiVersion="1"><diagram name="Main"/>\n<hmiProject version="1"><settings width="800" height="600"/>' +
		'</hmiProject></mxfile>';
	fs.writeFileSync(file, xml);
	server = new HmiWebServer({config: parseProjectConfig(xml, file), port: 0, host: '127.0.0.1', view: 'fill',
		webRoot: webRoot, bridgeFile: path.join(root, 'src', 'web', 'bridge.js'),
		shared: {base: dir, supervisor: () => { throw new Error('no comms here'); }, log: quiet, alarms: new AlarmEvents(),
			pruned: new Set()}, log: quiet});
	await server.start();
	port = server.http.address().port;
});

after(async () =>
{
	await server.stop();
	fs.rmSync(dir, {recursive: true, force: true});
});

test('the page is opened with the runtime settings and the view', async () =>
{
	const r = await get('/');
	assert.equal(r.status, 302);
	assert.equal(r.headers.location, '/?' + pageQuery('fill'));
	assert.match(r.headers.location, /hmiruntime=1/);
	assert.match(r.headers.location, /chrome=0/);
	assert.match(r.headers.location, /hmiviewmenu=1&hmiview=fill$/);
});

test('the bridge is loaded before bootstrap.js', async () =>
{
	const r = await get('/?hmiruntime=1');
	assert.equal(r.status, 200);
	const html = r.body.toString();
	assert.ok(html.indexOf('/hmi-web/bridge.js') > 0 && html.indexOf('/hmi-web/bridge.js') < html.indexOf('js/bootstrap.js'));
	assert.match(r.headers['content-security-policy'], /script-src 'self'/);
	assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
	assert.equal((await get('/hmi-web/bridge.js')).status, 200);
});

test('only the runtime\'s web app files are served', async () =>
{
	assert.equal((await get('/js/hmi/HmiRuntimeApp.js')).status, 200);
	assert.equal((await get('/styles/grapheditor.css')).status, 200);
	assert.equal((await get('/templates/basic/cross.xml')).status, 404);
	assert.equal((await get('/js/diagramly/Editor.js')).status, 404);
	assert.equal((await get('/js/app.min.js.map')).status, 404);
	assert.equal((await get('/../package.json')).status, 404);
	assert.equal((await get('/js/%2e%2e/%2e%2e/%2e%2e/%2e%2e/package.json')).status, 404);
	assert.equal((await get('/js/..%5c..%5cpackage.json')).status, 404);
	assert.equal((await get('/js/app.min.js', {}, 'POST')).status, 405);
});

test('paths are checked before any file is touched', () =>
{
	assert.equal(webappPath('/js/app.min.js'), 'js/app.min.js');
	assert.equal(webappPath('/img/lib/clip_art/computers/Database_128x128.png'), 'img/lib/clip_art/computers/Database_128x128.png');
	assert.equal(webappPath('/js/../../package.json'), null);
	assert.equal(webappPath('/%00'), null);
	assert.equal(webappPath('/%E0%A4%A'), null);
	assert.equal(webappPath('/'), null);
});

test('text is gzipped, and unchanged files are not sent again', async () =>
{
	const r = await get('/js/hmi/HmiRuntimeApp.js', {'Accept-Encoding': 'gzip'});
	assert.equal(r.headers['content-encoding'], 'gzip');
	assert.ok(Number(r.headers['content-length']) < fs.statSync(path.join(webRoot, 'js/hmi/HmiRuntimeApp.js')).size);

	const again = await get('/js/hmi/HmiRuntimeApp.js', {'If-Modified-Since': r.headers['last-modified']});
	assert.equal(again.status, 304);

	const head = await get('/js/hmi/HmiRuntimeApp.js', {}, 'HEAD');
	assert.equal(head.status, 200);
	assert.equal(head.body.length, 0);
	assert.equal((await get('/hmi-web/ping')).status, 204);
});

test('a browser runs the project over the WebSocket', async () =>
{
	const ws = new WebSocket('ws://127.0.0.1:' + port + WS_PATH, {headers: {Origin: 'http://127.0.0.1:' + port}});
	await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
	const replies = new Map();
	ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); replies.set(m.id, m); });
	const call = async (id, req) =>
	{
		ws.send(JSON.stringify({t: 'req', id: id, req: req}));

		for (let i = 0; i < 100 && !replies.has(id); i++)
		{
			await new Promise(r => setTimeout(r, 20));
		}

		return replies.get(id);
	};

	assert.equal(server.clients, 1);
	const info = await call(1, {action: 'hmiRuntime.info'});
	assert.equal(info.ok, true);
	assert.equal(info.data.productName, 'Pumps');
	const project = await call(2, {action: 'hmiRuntime.project'});
	assert.match(project.data.xml, /<hmiProject/);
	assert.equal(project.data.title, 'Pumps.ahmi');
	assert.equal((await call(3, {action: 'hmiRuntime.exit'})).data, false);
	assert.equal((await call(4, {action: 'somethingElse'})).data, null);
	const bad = await call(5, {action: 'hmiComms.write', values: 'nope'});
	assert.equal(bad.ok, false);

	ws.close();
	await new Promise(r => setTimeout(r, 100));
	assert.equal(server.clients, 0);
});

test('another site\'s page cannot connect', async () =>
{
	const ws = new WebSocket('ws://127.0.0.1:' + port + WS_PATH, {headers: {Origin: 'http://evil.example'}});
	const err = await new Promise((resolve) => { ws.on('error', resolve); ws.on('open', () => resolve(null)); });
	assert.ok(err != null && /403/.test(err.message), String(err && err.message));

	const noOrigin = new WebSocket('ws://127.0.0.1:' + port + WS_PATH);
	const err2 = await new Promise((resolve) => { noOrigin.on('error', resolve); noOrigin.on('open', () => resolve(null)); });
	assert.ok(err2 != null);
});

test('a port in use is reported plainly', async () =>
{
	const other = new HmiWebServer(Object.assign({}, server.opts, {port: port}));
	await assert.rejects(other.start(), /Port \d+ is already in use/);
});
