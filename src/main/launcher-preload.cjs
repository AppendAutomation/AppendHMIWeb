// The launcher page's only way to reach the main process: a fixed set of
// requests, each checked again in main (src/main/main.js).

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('launcher', {
	state: () => ipcRenderer.invoke('launcher:state'),
	browse: () => ipcRenderer.invoke('launcher:browse'),
	info: (file) => ipcRenderer.invoke('launcher:info', file),
	start: (file, options) => ipcRenderer.invoke('launcher:start', file, options),
	stop: (port) => ipcRenderer.invoke('launcher:stop', port),
	shortcut: (file, place, options) => ipcRenderer.invoke('launcher:shortcut', file, place, options),
	copy: (link) => ipcRenderer.invoke('launcher:copy', link),
	open: (link) => ipcRenderer.invoke('launcher:open', link),
	forget: (file) => ipcRenderer.invoke('launcher:forget', file),
	onServers: (fn) => ipcRenderer.on('launcher:servers', (e, list) => fn(list)),
	onError: (fn) => ipcRenderer.on('launcher:error', (e, message) => fn(message))
});
