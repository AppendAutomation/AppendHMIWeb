// The launcher window: choose an HMI application, set its port and view,
// start its web server or give it a shortcut, and share the link. Everything
// goes through window.launcher (src/main/launcher-preload.cjs).

(function()
{
	'use strict';

	const $ = (id) => document.getElementById(id);

	let state = null;
	let current = null;
	// Servers whose other addresses are shown (the list is redrawn often)
	const expanded = new Set();

	const pathText = (p) => '‎' + p;

	function status(text, isError)
	{
		const el = $('status');
		el.textContent = text || '';
		el.classList.toggle('error', isError === true);
	}

	function fail(e)
	{
		status(String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
	}

	function el(tag, cls, text)
	{
		const e = document.createElement(tag);

		if (cls) e.className = cls;
		if (text != null) e.textContent = text;

		return e;
	}

	function options()
	{
		return {port: Number($('port').value), view: $('view').value, localOnly: !$('remote').checked};
	}

	function runningFor(file)
	{
		return (state && state.servers || []).find(s => s.path === file) || null;
	}

	// Running when a server already serves the project with these settings;
	// Restart when this window serves it with others (it makes way); otherwise
	// Start, beside any server running in the background
	function updateStart()
	{
		const btn = $('start');
		const ok = current != null && current.error == null;
		const runs = ok ? (state && state.servers || []).filter(s => s.path === current.path) : [];
		const o = options();
		btn.disabled = !ok;

		if (runs.some(s => s.port === o.port && s.view === o.view && s.localOnly === o.localOnly))
		{
			btn.textContent = 'Running';
			btn.disabled = true;
		}
		else if (runs.some(s => s.here))
		{
			btn.textContent = 'Restart with these settings';
		}
		else
		{
			btn.textContent = 'Start web server';
		}

		$('desktop').disabled = !ok;
		$('menu').disabled = !ok;
	}

	function show(info)
	{
		current = info;
		const file = $('file');
		const details = $('details');

		if (info == null)
		{
			file.textContent = 'No application chosen';
			file.classList.add('empty');
			file.title = '';
			details.hidden = true;
			$('port').value = state ? state.defaultPort : '';
			updateStart();
			renderRecent();

			return;
		}

		file.textContent = pathText(info.path);
		file.classList.remove('empty');
		file.title = info.path;
		details.hidden = false;
		details.classList.toggle('failed', info.error != null);
		$('name').textContent = info.name;

		const o = info.options || {};
		$('port').value = o.port || state.defaultPort;
		$('view').value = o.view || 'fit';
		$('remote').checked = o.localOnly !== true;

		if (info.error != null)
		{
			$('summary').textContent = '';
			$('error').textContent = info.error;
			$('error').hidden = false;
		}
		else
		{
			$('summary').textContent = 'Screen ' + info.width + ' × ' + info.height;
			$('error').hidden = true;
		}

		updateStart();
		renderRecent();
	}

	function copyButton(link, label)
	{
		const b = el('button', null, label || 'Copy');
		b.dataset.field = 'copy';
		b.addEventListener('click', async () =>
		{
			try
			{
				await window.launcher.copy(link);
				const was = b.textContent;
				b.textContent = 'Copied';
				setTimeout(() => { b.textContent = was; }, 1500);
				status('Copied ' + link);
			}
			catch (e)
			{
				fail(e);
			}
		});

		return b;
	}

	function renderRunning()
	{
		const box = $('running');
		box.textContent = '';
		const list = (state && state.servers) || [];
		$('running-section').hidden = list.length === 0;

		for (const s of list)
		{
			const div = el('div', 'server');
			div.dataset.port = s.port;

			const head = el('div', 'server-head');
			const browsers = s.clients == null ? 'not answering' :
				(s.clients === 1 ? '1 browser connected' : s.clients + ' browsers connected');
			head.append(el('span', 'server-name', s.name),
				el('span', 'server-meta', 'Port ' + s.port + (s.localOnly ? ' · this computer only' : '') + ' · ' + browsers));

			// Stop or restart this server, whichever process runs it
			const act = (button, label, busy, done, fn) =>
			{
				button.textContent = label;
				button.addEventListener('click', async () =>
				{
					div.querySelectorAll('button').forEach(b => { b.disabled = true; });
					button.textContent = busy;
					status(busy + ' ' + s.name + '…');

					try
					{
						await fn(s.port);
						status(done);
					}
					catch (e)
					{
						fail(e);
					}

					await refresh();
				});
			};

			const restart = el('button');
			restart.dataset.field = 'restart';
			restart.title = 'Stop and start again, reading the project file afresh';
			act(restart, 'Restart', 'Restarting', s.name + ' restarted.', (p) => window.launcher.restart(p));
			const stop = el('button', 'danger');
			stop.dataset.field = 'stop';
			act(stop, 'Stop', 'Stopping', 'Stopped ' + s.name + '.', (p) => window.launcher.stop(p));
			head.append(restart, stop);

			const owner = el('span', 'server-owner ' + (s.here ? 'here' : 'background'),
				s.here ? 'in this window' : 'in the background');
			owner.title = s.here ? 'Stops when this window closes' :
				'Started separately (--headless); keeps running when this window closes';
			const where = el('span', 'server-path', pathText(s.path));
			where.title = s.path;
			const sub = el('div', 'server-sub');
			sub.append(owner, where);

			const main = s.links[0];
			const row = el('div', 'link-row');
			const link = el('div', 'link', main.url);
			link.dataset.field = 'link';
			link.title = main.label;
			const open = el('button', null, 'Open');
			open.dataset.field = 'open';
			open.addEventListener('click', () => window.launcher.open(main.url).catch(fail));
			const copy = copyButton(main.url);
			copy.classList.add('primary');
			row.append(link, copy, open);

			div.append(head, sub, row);

			if (s.links.length > 1)
			{
				const more = el('details', 'other-links');
				more.open = expanded.has(s.port);
				more.addEventListener('toggle', () => { more.open ? expanded.add(s.port) : expanded.delete(s.port); });
				more.appendChild(el('summary', null, 'Other addresses (' + (s.links.length - 1) + ')'));
				const others = el('ul');

				for (const l of s.links.slice(1))
				{
					const li = el('li');
					li.append(el('span', 'other-url', l.url), el('span', null, '(' + l.label + ')'), copyButton(l.url));
					others.appendChild(li);
				}

				more.appendChild(others);
				div.appendChild(more);
			}

			box.appendChild(div);
		}

		updateStart();
		renderRecent();
	}

	function renderRecent()
	{
		const list = $('recent');
		list.textContent = '';
		const recent = (state && state.recent) || [];
		$('no-recent').hidden = recent.length > 0;

		for (const r of recent)
		{
			const li = el('li');
			li.dataset.path = r.path;
			li.classList.toggle('selected', current != null && current.path === r.path);
			li.classList.toggle('missing', !r.exists);
			li.title = r.exists ? r.path : r.path + ' (not found)';

			const running = runningFor(r.path);
			const name = el('span', 'recent-name', r.name.replace(/\.(ahmi|drawio-hmi)$/i, '') +
				(running ? '  ●' : ''));
			const where = el('span', 'recent-path', pathText(r.path));
			const forget = el('button', 'forget', '×');
			forget.title = 'Remove from the list';

			forget.addEventListener('click', async (e) =>
			{
				e.stopPropagation();
				await window.launcher.forget(r.path);
				await refresh();

				if (current != null && current.path === r.path)
				{
					show(null);
				}
			});

			li.addEventListener('click', () => select(r.path));
			li.append(name, where, forget);
			list.appendChild(li);
		}
	}

	async function refresh()
	{
		state = await window.launcher.state();
		renderRunning();
	}

	async function select(file)
	{
		status('');

		try
		{
			show(await window.launcher.info(file));
		}
		catch (e)
		{
			fail(e);
		}
	}

	$('browse').addEventListener('click', async () =>
	{
		try
		{
			const info = await window.launcher.browse();

			if (info != null)
			{
				status('');
				show(info);
			}
		}
		catch (e)
		{
			fail(e);
		}
	});

	$('start').addEventListener('click', async () =>
	{
		const o = options();

		if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535)
		{
			status('The port must be a number from 1 to 65535.', true);

			return;
		}

		try
		{
			status('Starting ' + current.name + '…');
			const s = await window.launcher.start(current.path, o);
			await refresh();
			status(current.name + ' is being served at ' + s.links[0].url);
		}
		catch (e)
		{
			fail(e);
		}
	});

	async function shortcut(place)
	{
		try
		{
			const file = await window.launcher.shortcut(current.path, place, options());
			status((place === 'desktop' ? 'Desktop shortcut created: ' : 'Menu entry created: ') + file);
			await refresh();
		}
		catch (e)
		{
			fail(e);
		}
	}

	$('desktop').addEventListener('click', () => shortcut('desktop'));
	$('menu').addEventListener('click', () => shortcut('menu'));

	for (const id of ['port', 'view', 'remote'])
	{
		$(id).addEventListener('input', updateStart);
		$(id).addEventListener('change', updateStart);
	}

	window.launcher.onServers((list) =>
	{
		if (state != null)
		{
			state.servers = list;
			renderRunning();
		}
	});

	window.launcher.onError((message) => status(message, true));

	(async () =>
	{
		try
		{
			await refresh();
			$('version').textContent = 'Version ' + state.version;

			if (state.error)
			{
				status(state.error, true);
			}

			if (state.platform !== 'win32')
			{
				$('menu').textContent = 'Add to applications menu';
			}

			const run = state.servers[0];
			const first = run != null ? run : state.recent.find(r => r.exists);

			if (first != null)
			{
				await select(first.path);
			}
			else
			{
				show(null);
			}
		}
		catch (e)
		{
			fail(e);
		}
	})();
})();
