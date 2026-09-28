// The editor web app files a browser may load: the ones Append HMI Studio's
// run-only renderer uses (measured on a running project). The server refuses
// every other path, and packaging ships only these (the electron-builder
// configs repeat the list; src/test/packaging.test.js keeps them in step).

export const WEBAPP_DIR = 'studio/drawio/src/main/webapp';

export const WEBAPP_FILES = [
	'index.html',
	'js/bootstrap.js',
	'js/main.js',
	'js/PreConfig.js',
	'js/PostConfig.js',
	'js/app.min.js',
	'js/extensions.min.js',
	'js/stencils.min.js',
	'js/shapes-*.min.js',
	'js/plantuml/**',
	'js/hmi/**',
	'js/diagramly/ElectronApp.js',
	'js/diagramly/DesktopLibrary.js',
	'styles/**',
	'css/**',
	'mxgraph/css/**',
	'mxgraph/images/**',
	'images/**',
	'img/**',
	'math4/**',
	'resources/dia.txt'
];

// A glob of the small kind used here: * within a name, ** for anything
export function globMatch(pattern, file)
{
	const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*')
		.replace(/\u0000/g, '.*');

	return new RegExp('^' + re + '$').test(file);
}

export function isWebappFile(rel)
{
	return !rel.endsWith('.map') && WEBAPP_FILES.some(p => globMatch(p, rel));
}
