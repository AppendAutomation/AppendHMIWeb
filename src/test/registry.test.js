import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {ServerRegistry, newToken} from '../main/registry.js';

function tempDir()
{
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-registry-')), 'servers');
}

// A process id that is certainly not running
function deadPid()
{
	const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {encoding: 'utf8'});

	return Number(r.stdout);
}

test('servers are registered by port, readable only by their user', () =>
{
	const dir = tempDir();
	const reg = new ServerRegistry(dir);
	reg.register({port: 8480, projectPath: '/p/A.ahmi', name: 'A', view: 'fit', localOnly: false, token: newToken()});
	const list = reg.list();
	assert.equal(list.length, 1);
	assert.equal(list[0].pid, process.pid);
	assert.equal(list[0].name, 'A');
	assert.match(list[0].token, /^[0-9a-f]{48}$/);
	assert.ok(list[0].startedAt);

	if (process.platform !== 'win32')
	{
		assert.equal(fs.statSync(path.join(dir, '8480.json')).mode & 0o777, 0o600);
		assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
	}

	assert.deepEqual(reg.others(), [], 'its own servers are not "others"');
	fs.rmSync(path.dirname(dir), {recursive: true, force: true});
});

test('other processes\' servers are listed; dead ones are cleaned up', () =>
{
	const dir = tempDir();
	const mine = new ServerRegistry(dir);
	const theirs = new ServerRegistry(dir, process.ppid);
	const gone = new ServerRegistry(dir, deadPid());
	theirs.register({port: 9001, projectPath: '/p/B.ahmi', name: 'B', token: newToken()});
	gone.register({port: 9002, projectPath: '/p/C.ahmi', name: 'C', token: newToken()});
	fs.writeFileSync(path.join(dir, '9003.json'), '{broken');

	assert.deepEqual(mine.others().map(e => e.port), [9001]);
	assert.ok(!fs.existsSync(path.join(dir, '9002.json')), 'a dead process\'s entry is removed');
	assert.ok(!fs.existsSync(path.join(dir, '9003.json')), 'a damaged entry is removed');
	fs.rmSync(path.dirname(dir), {recursive: true, force: true});
});

test('only the owner unregisters its server', () =>
{
	const dir = tempDir();
	const mine = new ServerRegistry(dir);
	const theirs = new ServerRegistry(dir, process.ppid);
	theirs.register({port: 9001, name: 'B', token: newToken()});
	mine.unregister(9001);
	assert.equal(mine.list().length, 1);
	theirs.unregister(9001);
	assert.equal(mine.list().length, 0);
	mine.unregister(9999);
	fs.rmSync(path.dirname(dir), {recursive: true, force: true});
});

test('an empty or missing folder lists nothing', () =>
{
	assert.deepEqual(new ServerRegistry(path.join(os.tmpdir(), 'hmi-web-no-such-' + process.pid)).list(), []);
});
