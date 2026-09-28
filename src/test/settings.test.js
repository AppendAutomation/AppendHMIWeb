import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {Settings, MAX_RECENT} from '../main/settings.js';

test('recent projects: newest first, no duplicates, limited, kept', () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-settings-'));

	try
	{
		const s = new Settings(dir);
		assert.deepEqual(s.recent, []);

		s.addRecent('/a.ahmi', 'linux');
		s.addRecent('/b.ahmi', 'linux');
		s.addRecent('/a.ahmi', 'linux');
		assert.deepEqual(s.recent, ['/a.ahmi', '/b.ahmi']);

		s.addRecent('C:\\B.ahmi', 'win32');
		s.addRecent('c:\\b.ahmi', 'win32');
		assert.deepEqual(s.recent, ['c:\\b.ahmi', '/a.ahmi', '/b.ahmi']);

		for (let i = 0; i < 20; i++)
		{
			s.addRecent('/p' + i + '.ahmi', 'linux');
		}

		assert.equal(s.recent.length, MAX_RECENT);
		assert.equal(new Settings(dir).recent[0], '/p19.ahmi');

		s.removeRecent('/p19.ahmi');
		assert.equal(new Settings(dir).recent[0], '/p18.ahmi');
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('a damaged file, or entries that are not projects, are ignored', () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-settings-'));

	try
	{
		fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
		assert.deepEqual(new Settings(dir).recent, []);

		fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({recent: ['/x.ahmi', 5, '/src/app', '/y.drawio-hmi']}));
		assert.deepEqual(new Settings(dir).recent, ['/x.ahmi', '/y.drawio-hmi']);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

test('each project remembers its server options', () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-settings-'));

	try
	{
		const s = new Settings(dir);
		assert.equal(s.serverOptions('/a.ahmi'), null);
		s.setServerOptions('/a.ahmi', {port: 9000, view: 'fill', localOnly: true});
		assert.deepEqual(s.recent, ['/a.ahmi']);
		assert.deepEqual(new Settings(dir).serverOptions('/a.ahmi'), {port: 9000, view: 'fill', localOnly: true});

		s.removeRecent('/a.ahmi');
		assert.equal(new Settings(dir).serverOptions('/a.ahmi'), null);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
