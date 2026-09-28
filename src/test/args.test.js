import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {parseArgs, userArgs, serverArgs, validPort} from '../main/args.js';

test('a project with options', () =>
{
	const a = parseArgs(['--port', '9000', '--view=fill', '--local-only', 'C:\\Plant\\Line 3.ahmi']);
	assert.equal(a.project, 'C:\\Plant\\Line 3.ahmi');
	assert.equal(a.port, 9000);
	assert.equal(a.view, 'fill');
	assert.equal(a.localOnly, true);
	assert.equal(a.error, null);
});

test('defaults are left to the caller', () =>
{
	const a = parseArgs(['x.ahmi']);
	assert.equal(a.port, null);
	assert.equal(a.view, null);
	assert.equal(a.localOnly, false);
	assert.equal(a.headless, false);
});

test('no arguments open the launcher', () =>
{
	assert.equal(parseArgs([]).project, null);
	assert.equal(parseArgs([]).error, null);
});

test('bad options are errors', () =>
{
	assert.match(parseArgs(['--port', 'eighty', 'x.ahmi']).error, /1 to 65535/);
	assert.match(parseArgs(['--port', '70000', 'x.ahmi']).error, /1 to 65535/);
	assert.match(parseArgs(['--view', 'zoom', 'x.ahmi']).error, /fit, fill, original/);
	assert.match(parseArgs(['--headless']).error, /--headless needs a project/);
	assert.match(parseArgs(['--create-shortcut', 'desktop']).error, /needs a project/);
	assert.match(parseArgs(['--create-shortcut', 'startup', 'x.ahmi']).error, /desktop, menu/);
	assert.match(parseArgs(['--bogus']).error, /Unknown option/);
	assert.match(parseArgs(['a.ahmi', 'b.ahmi']).error, /Only one project/);
});

test('Electron and Chromium switches pass through', () =>
{
	assert.equal(parseArgs(['--no-sandbox', '--remote-debugging-port=9222', 'x.ahmi']).error, null);
});

test('shortcut arguments reproduce the settings', () =>
{
	assert.deepEqual(serverArgs({port: 8480, view: 'fit', localOnly: false}), ['--port', '8480']);
	assert.deepEqual(serverArgs({port: 9000, view: 'original', localOnly: true}),
		['--port', '9000', '--view', 'original', '--local-only']);
	const back = parseArgs(serverArgs({port: 9000, view: 'fill', localOnly: true}).concat(['x.ahmi']));
	assert.deepEqual([back.port, back.view, back.localOnly], [9000, 'fill', true]);
});

test('ports', () =>
{
	assert.equal(validPort('8480'), 8480);
	assert.equal(validPort(0), null);
	assert.equal(validPort(1.5), null);
});

test('the app folder is dropped wherever a second instance puts it', () =>
{
	const opts = {defaultApp: true, appPath: '/src/web', resolve: (a) => path.resolve('/src/web', a)};
	assert.deepEqual(userArgs(['/e/electron', '--no-sandbox', '.'], opts), ['--no-sandbox']);
	assert.deepEqual(userArgs(['/opt/app', 'x.ahmi'], {defaultApp: false, appPath: '/opt', resolve: (a) => a}), ['x.ahmi']);
});
