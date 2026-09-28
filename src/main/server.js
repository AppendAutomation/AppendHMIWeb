// The web server for one project: the HMI page and the editor web app files
// it loads over HTTP, and each browser's runtime requests over a WebSocket
// (/hmi-web/ws, see src/web/bridge.js and rpc.js).

import fs from 'fs';
import http from 'http';
import path from 'path';
import zlib from 'zlib';
import {WebSocketServer} from 'ws';
import {isWebappFile} from './webfiles.js';
import {BrowserSession} from './rpc.js';

export const WS_PATH = '/hmi-web/ws';
export const BRIDGE_PATH = '/hmi-web/bridge.js';
export const PING_PATH = '/hmi-web/ping';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.json': 'application/json',
	'.xml': 'application/xml',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.wasm': 'application/wasm',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav'
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.txt', '.json', '.xml', '.svg']);

// What the runtime page is opened with (the query Append HMI Desktop gives
// its windows, plus the browser's view settings)
export function pageQuery(view)
{
	return new URLSearchParams({
		dev: '0', test: '0', gapi: '0', db: '0', od: '0', gh: '0', gl: '0', tr: '0',
		browser: '0', picker: '0', mode: 'device', disableUpdate: '1', enableSpellCheck: '0',
		enableStoreBkp: '0', isGoogleFontsEnabled: '0', chrome: '0', hmiruntime: '1', appLang: 'en',
		hmiviewmenu: '1', hmiview: view || 'fit'
	}).toString();
}

// The request path as a web app file, or null for anything else
export function webappPath(urlPath)
{
	let rel;

	try
	{
		rel = decodeURIComponent(urlPath);
	}
	catch (e)
	{
		return null;
	}

	if (rel.includes('\0') || rel.includes('\\'))
	{
		return null;
	}

	rel = path.posix.normalize(rel).replace(/^\/+/, '');

	if (rel === '' || rel.split('/').includes('..') || !isWebappFile(rel))
	{
		return null;
	}

	return rel;
}

// opts: config (the project, project.js), port, host, view, webRoot (the web
// app folder), bridgeFile, shared (rpc.js's shared state, less config), log
export class HmiWebServer
{
	constructor(opts)
	{
		this.opts = opts;
		this.sessions = new Set();
		this.gzip = new Map();
		this.listeners = new Set();
	}

	get clients()
	{
		return this.sessions.size;
	}

	onChange(fn)
	{
		this.listeners.add(fn);
	}

	changed()
	{
		for (const fn of this.listeners)
		{
			try { fn(this); } catch (e) {}
		}
	}

	start()
	{
		return new Promise((resolve, reject) =>
		{
			this.http = http.createServer((req, res) => this.request(req, res));
			this.wss = new WebSocketServer({noServer: true, maxPayload: 16 * 1024 * 1024});

			this.http.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));

			const failed = (e) =>
			{
				reject(e.code === 'EADDRINUSE' ? new Error('Port ' + this.opts.port + ' is already in use. ' +
					'Choose another port.') : (e.code === 'EACCES' ? new Error('Port ' + this.opts.port +
					' needs administrator rights. Choose a port above 1024.') : e));
			};

			this.http.once('error', failed);
			this.http.listen(this.opts.port, this.opts.host, () =>
			{
				this.http.off('error', failed);
				this.http.on('error', (e) => this.opts.log.error('Web server: ' + e.message));
				resolve(this);
			});
		});
	}

	stop()
	{
		for (const s of this.sessions)
		{
			s.close();
		}

		this.sessions.clear();

		for (const ws of (this.wss ? this.wss.clients : []))
		{
			ws.terminate();
		}

		return new Promise((resolve) =>
		{
			if (this.http == null || !this.http.listening)
			{
				resolve();

				return;
			}

			this.http.close(() => resolve());
			this.http.closeAllConnections();
		});
	}

	headers(extra)
	{
		return Object.assign({
			'Content-Security-Policy': 'default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; ' +
				'connect-src \'self\'; img-src * data:; media-src *; font-src * data:; frame-src \'self\'; ' +
				'style-src \'self\' \'unsafe-inline\'; base-uri \'none\'; child-src \'self\'; object-src \'none\'; ' +
				'frame-ancestors \'none\';',
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Cache-Control': 'no-cache'
		}, extra);
	}

	request(req, res)
	{
		if (req.method !== 'GET' && req.method !== 'HEAD')
		{
			res.writeHead(405, this.headers({Allow: 'GET, HEAD'}));
			res.end();

			return;
		}

		const u = new URL(req.url, 'http://localhost');

		if (u.pathname === PING_PATH)
		{
			res.writeHead(204, this.headers());
			res.end();

			return;
		}

		// The page needs its runtime settings in the query
		if ((u.pathname === '/' || u.pathname === '/index.html') && u.searchParams.get('hmiruntime') !== '1')
		{
			res.writeHead(302, this.headers({Location: '/?' + pageQuery(this.opts.view)}));
			res.end();

			return;
		}

		if (u.pathname === '/' || u.pathname === '/index.html')
		{
			this.sendIndex(req, res);

			return;
		}

		if (u.pathname === BRIDGE_PATH)
		{
			this.sendFile(req, res, this.opts.bridgeFile, '.js');

			return;
		}

		const rel = webappPath(u.pathname);

		if (rel == null)
		{
			res.writeHead(404, this.headers({'Content-Type': 'text/plain'}));
			res.end('Not found');

			return;
		}

		this.sendFile(req, res, path.join(this.opts.webRoot, rel), path.extname(rel).toLowerCase());
	}

	// index.html with the bridge loaded first, so the page finds its
	// window.electron before bootstrap.js looks for it
	sendIndex(req, res)
	{
		fs.readFile(path.join(this.opts.webRoot, 'index.html'), 'utf8', (err, html) =>
		{
			if (err)
			{
				res.writeHead(500, this.headers());
				res.end();

				return;
			}

			const tag = '<script src="js/bootstrap.js"></script>';
			const page = html.includes(tag) ? html.replace(tag, '<script src="' + BRIDGE_PATH + '"></script>\n\t' + tag) :
				html.replace('</head>', '<script src="' + BRIDGE_PATH + '"></script></head>');
			this.send(req, res, Buffer.from(page), '.html', null);
		});
	}

	sendFile(req, res, file, ext)
	{
		fs.stat(file, (err, st) =>
		{
			if (err || !st.isFile())
			{
				res.writeHead(404, this.headers({'Content-Type': 'text/plain'}));
				res.end('Not found');

				return;
			}

			const modified = st.mtime.toUTCString();

			if (req.headers['if-modified-since'] === modified)
			{
				res.writeHead(304, this.headers({'Last-Modified': modified}));
				res.end();

				return;
			}

			fs.readFile(file, (err2, data) =>
			{
				if (err2)
				{
					res.writeHead(500, this.headers());
					res.end();

					return;
				}

				this.send(req, res, data, ext, modified, file + ':' + st.mtimeMs);
			});
		});
	}

	// Text is sent gzipped when the browser takes it (app.min.js is 9 MB),
	// compressed once per file version
	send(req, res, data, ext, modified, cacheKey)
	{
		const headers = this.headers({'Content-Type': TYPES[ext] || 'application/octet-stream', Vary: 'Accept-Encoding'});

		if (modified != null)
		{
			headers['Last-Modified'] = modified;
		}

		let body = data;

		if (COMPRESSIBLE.has(ext) && data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || ''))
		{
			body = cacheKey != null ? this.gzip.get(cacheKey) : null;

			if (body == null)
			{
				body = zlib.gzipSync(data, {level: 6});

				if (cacheKey != null)
				{
					this.gzip.set(cacheKey, body);
				}
			}

			headers['Content-Encoding'] = 'gzip';
		}

		headers['Content-Length'] = body.length;
		res.writeHead(200, headers);
		res.end(req.method === 'HEAD' ? undefined : body);
	}

	upgrade(req, socket, head)
	{
		const u = new URL(req.url, 'http://localhost');
		const origin = req.headers.origin;

		// Only the server's own page may connect: a page on another site open
		// in the same browser must not drive the HMI
		if (u.pathname !== WS_PATH || origin == null || new URL(origin).host !== req.headers.host)
		{
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
			socket.destroy();

			return;
		}

		this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws, req));
	}

	connected(ws, req)
	{
		const send = (msg) =>
		{
			if (ws.readyState === ws.OPEN)
			{
				ws.send(JSON.stringify(msg));
			}
		};

		const session = new BrowserSession(Object.assign({config: this.opts.config}, this.opts.shared),
			(channel, data) => send({t: 'event', channel: channel, data: data}));
		const who = req.socket.remoteAddress;
		this.sessions.add(session);
		this.opts.log.info(this.opts.config.productName + ': browser connected from ' + who + ' (' + this.clients + ')');
		this.changed();

		ws.on('message', async (raw) =>
		{
			let msg;

			try
			{
				msg = JSON.parse(raw.toString());
			}
			catch (e)
			{
				return;
			}

			if (msg == null || msg.t !== 'req' || msg.req == null)
			{
				return;
			}

			try
			{
				send({t: 'resp', id: msg.id, ok: true, data: await session.handle(msg.req)});
			}
			catch (e)
			{
				send({t: 'resp', id: msg.id, ok: false, error: e.message});
			}
		});

		ws.on('close', () =>
		{
			session.close();
			this.sessions.delete(session);
			this.opts.log.info(this.opts.config.productName + ': browser disconnected from ' + who + ' (' + this.clients + ')');
			this.changed();
		});
	}
}
