// Append HMI Web's browser bridge, loaded before the editor's bootstrap.js.
//
// Append HMI Studio's run-only renderer talks to its main process through
// window.electron (Electron's preload). Here the same object carries its
// requests to the web server over a WebSocket, so the renderer runs unchanged
// in any browser. hmiWeb tells bootstrap.js, and window.process the editor, to
// run the page as they do in the desktop apps.

(function()
{
	'use strict';

	var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/hmi-web/ws';
	var socket = null;
	var queue = [];
	var pending = {};
	var listeners = {};
	var nextId = 1;
	var lost = false;

	function connect()
	{
		socket = new WebSocket(url);

		socket.onopen = function()
		{
			var q = queue;
			queue = [];

			for (var i = 0; i < q.length; i++)
			{
				socket.send(q[i]);
			}
		};

		socket.onmessage = function(evt)
		{
			var msg;

			try
			{
				msg = JSON.parse(evt.data);
			}
			catch (e)
			{
				return;
			}

			if (msg.t === 'resp' && pending[msg.id] != null)
			{
				var p = pending[msg.id];
				delete pending[msg.id];

				if (msg.ok)
				{
					p.callback(msg.data);
				}
				else if (p.error != null)
				{
					p.error(msg.error);
				}
			}
			else if (msg.t === 'event')
			{
				var list = listeners[msg.channel] || [];

				for (var j = 0; j < list.length; j++)
				{
					list[j](msg.data);
				}
			}
		};

		socket.onclose = function()
		{
			connectionLost();
		};
	}

	// The server stopped or the network dropped: say so, and reload once the
	// server answers again (the runtime starts over, as after a power cut)
	function connectionLost()
	{
		if (lost)
		{
			return;
		}

		lost = true;

		var show = function()
		{
			var div = document.createElement('div');
			div.className = 'hmiWebLost';
			div.setAttribute('style', 'position:fixed;inset:0;z-index:30000;display:flex;align-items:center;' +
				'justify-content:center;background:rgba(0,0,0,0.7);color:#fff;font:16px system-ui,sans-serif;');
			div.textContent = 'Connection to the HMI server lost. Reconnecting…';
			document.body.appendChild(div);
		};

		if (document.body != null)
		{
			show();
		}
		else
		{
			document.addEventListener('DOMContentLoaded', show);
		}

		var retry = function()
		{
			fetch('/hmi-web/ping', {cache: 'no-store'}).then(function(r)
			{
				if (r.ok)
				{
					location.reload();
				}
				else
				{
					setTimeout(retry, 3000);
				}
			})['catch'](function()
			{
				setTimeout(retry, 3000);
			});
		};

		setTimeout(retry, 2000);
	}

	function post(text)
	{
		if (socket != null && socket.readyState === WebSocket.OPEN)
		{
			socket.send(text);
		}
		else
		{
			queue.push(text);
		}
	}

	// Electron's preload also exposes this; the editor checks
	// process.versions.electron (EditorUi.isElectronApp) as well as
	// window.electron, and would otherwise load its web-only parts
	window.process = {type: 'renderer', versions: {electron: 'hmi-web'}};

	window.electron = {
		hmiWeb: true,
		request: function(msg, callback, error)
		{
			var id = nextId++;
			pending[id] = {callback: callback || function() {}, error: error};
			post(JSON.stringify({t: 'req', id: id, req: msg}));
		},
		registerMsgListener: function(channel, callback)
		{
			(listeners[channel] = listeners[channel] || []).push(callback);
		},
		sendMessage: function() {},
		listenOnce: function() {}
	};

	connect();
})();
