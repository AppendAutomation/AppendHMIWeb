import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {parseProjectConfig, loadProjectConfig, projectName, isProjectFile, elementAttributes, describe} from
	'../main/project.js';

const project = (settings) => '<mxfile hmiVersion="1"><diagram name="Main"><mxGraphModel><root>' +
	'<mxCell id="0"/></root></mxGraphModel></diagram>\n<hmiProject version="1">\n<devices/>\n<tags/>\n' +
	settings + '\n</hmiProject></mxfile>';

test('defaults: kiosk, exit shortcut, 1024 x 768', () =>
{
	const c = parseProjectConfig(project('<settings width="1024" height="768"/>'), '/p/Line 3.ahmi');
	assert.equal(c.productName, 'Line 3');
	assert.equal(c.windowMode, 'kiosk');
	assert.equal(c.exit.mode, 'shortcut');
	assert.equal(c.width, 1024);
	assert.equal(c.height, 768);
	assert.equal(c.projectPath, '/p/Line 3.ahmi');
});

test('the project\'s runtime settings', () =>
{
	const hash = 'AB'.repeat(32);
	const c = parseProjectConfig(project('<settings width="1920" height="1080">' +
		'<startup page="p1"/><runtime windowMode="window" exit="password" salt="00ff" hash="' + hash + '" />' +
		'</settings>'), '/p/x.ahmi');
	assert.equal(c.windowMode, 'window');
	assert.equal(c.width, 1920);
	assert.equal(c.height, 1080);
	assert.deepEqual(c.exit, {mode: 'password', salt: '00ff', hash: hash.toLowerCase()});
});

test('a desktop exit password does not stop a project being served', () =>
{
	const c = parseProjectConfig(project('<settings width="1024" height="768">' +
		'<runtime windowMode="kiosk" exit="password" /></settings>'), '/p/x.ahmi');
	assert.equal(c.productName, 'x');
});

test('unknown values fall back to the defaults', () =>
{
	const c = parseProjectConfig(project('<settings width="9" height="abc"><runtime windowMode="huge" exit="nope"/>' +
		'</settings>'), '/p/x.ahmi');
	assert.equal(c.windowMode, 'kiosk');
	assert.equal(c.exit.mode, 'shortcut');
	assert.equal(c.width, 1024);
	assert.equal(c.height, 768);
});

test('a plain diagram is not a project', () =>
{
	assert.throws(() => parseProjectConfig('<mxfile><diagram/></mxfile>', '/p/x.ahmi'), /not an Append HMI Studio project/);
});

test('attributes are decoded', () =>
{
	assert.deepEqual(elementAttributes('<a x="1 &amp; 2" y=\'&lt;&#65;&#x42;&gt;\'/>', 'a'), {x: '1 & 2', y: '<AB>'});
	assert.equal(elementAttributes('<ab x="1"/>', 'a'), null);
});

test('names and extensions', () =>
{
	assert.equal(projectName('/p/Line 3.ahmi'), 'Line 3');
	assert.equal(projectName('C:\\p\\Old.drawio-hmi'.replace(/\\/g, '/')), 'Old');
	assert.ok(isProjectFile('x.AHMI'));
	assert.ok(isProjectFile('x.drawio-hmi'));
	assert.ok(!isProjectFile('x.drawio'));
	assert.ok(!isProjectFile(null));
});

test('files are read and checked', async () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-'));

	try
	{
		const file = path.join(dir, 'Pumps.ahmi');
		fs.writeFileSync(file, project('<settings width="800" height="600"><runtime windowMode="fullscreen" ' +
			'exit="never"/></settings>'));
		const c = await loadProjectConfig(file);
		assert.deepEqual(describe(c), {path: file, name: 'Pumps', width: 800, height: 600});

		await assert.rejects(loadProjectConfig(path.join(dir, 'missing.ahmi')), /Cannot find/);
		await assert.rejects(loadProjectConfig(path.join(dir, 'x.txt')), /Not an HMI project/);
		fs.mkdirSync(path.join(dir, 'folder.ahmi'));
		await assert.rejects(loadProjectConfig(path.join(dir, 'folder.ahmi')), /Not a usable project file/);
	}
	finally
	{
		fs.rmSync(dir, {recursive: true, force: true});
	}
});
