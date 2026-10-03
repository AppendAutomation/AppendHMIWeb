import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {AlarmEvents, BrowserSession} from '../main/rpc.js';

const ev = (event, tag, condition) => ({time: Date.now(), tag, event, condition, value: 1, description: '', limit: null});

test('an alarm reported by several browsers is written once', () =>
{
	const a = new AlarmEvents();
	assert.equal(a.fresh([ev('ALM', 'Level', 'hiHi')]).length, 1);
	assert.equal(a.fresh([ev('ALM', 'Level', 'hiHi')]).length, 0, 'a second browser');
	assert.equal(a.fresh([ev('ALM', 'level', 'hiHi')]).length, 0, 'names are case-insensitive');
});

test('a browser opened while an alarm is active adds nothing', () =>
{
	const a = new AlarmEvents();
	a.fresh([ev('ALM', 'Level', 'hiHi'), ev('ACK', 'Level', 'hiHi')]);
	assert.equal(a.fresh([ev('ALM', 'Level', 'hiHi')]).length, 0);
	assert.equal(a.fresh([ev('ACK', 'Level', 'hiHi')]).length, 0, 'one acknowledgement per alarm');
});

test('real changes are all written', () =>
{
	const a = new AlarmEvents();
	assert.equal(a.fresh([ev('ALM', 'Level', 'high')]).length, 1);
	assert.equal(a.fresh([ev('ALM', 'Level', 'hiHi')]).length, 1, 'escalation');
	assert.equal(a.fresh([ev('CHG', 'Level', 'high')]).length, 1, 'easing back');
	assert.equal(a.fresh([ev('CHG', 'Level', 'high')]).length, 0);
	assert.equal(a.fresh([ev('RTN', 'Level', null)]).length, 1);
	assert.equal(a.fresh([ev('RTN', 'Level', null)]).length, 0, 'returned once');
	assert.equal(a.fresh([ev('ALM', 'Level', 'high')]).length, 1, 'a new alarm after the return');
	assert.equal(a.fresh([ev('ACK', 'Level', 'high')]).length, 1);
	assert.equal(a.fresh([ev('ALM', 'Pump', 'on'), ev('ALM', 'Pump', 'on'), null]).length, 1, 'within one batch');
});

test('a browser session keeps runtime users and retentive values on the server', async () =>
{
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-rpc-'));

	try
	{
		const file = path.join(base, 'Plant.ahmi');
		fs.writeFileSync(file, '<mxfile/>');
		const shared = {config: {projectPath: file, productName: 'Plant', version: '', windowMode: 'kiosk', exit: {mode: 'shortcut'}},
			base: base, supervisor: () => null, log: {info() {}, warn() {}, error() {}}, alarms: new AlarmEvents(), pruned: new Set()};
		const s = new BrowserSession(shared, () => {});

		assert.deepEqual(await s.handle({action: 'hmiRetentive.load', store: 'Plant'}), {});
		await s.handle({action: 'hmiRetentive.save', store: 'Plant', values: {Setpoint: 42}});
		assert.deepEqual(await new BrowserSession(shared, () => {}).handle({action: 'hmiRetentive.load', store: 'Plant'}), {Setpoint: 42});

		const users = [{name: 'op', level: 5, salt: '00112233445566778899aabbccddeeff', hash: 'ab'.repeat(32), iterations: 20000}];
		await s.handle({action: 'hmiUsers.save', store: 'Plant', users: users});
		assert.equal((await s.handle({action: 'hmiUsers.load', store: 'Plant'}))[0].name, 'op');

		// Recipes are shared by every browser; CSV files stay in the browser
		assert.equal(await s.handle({action: 'hmiRecipes.load', store: 'Plant'}), null);
		await s.handle({action: 'hmiRecipes.save', store: 'Plant', books: {Mix: {'Batch A': {Setpoint: 42, Name: 'A'}}}});
		assert.deepEqual(await new BrowserSession(shared, () => {}).handle({action: 'hmiRecipes.load', store: 'Plant'}),
			{Mix: {'Batch A': {Setpoint: 42, Name: 'A'}}});
		assert.equal(await s.handle({action: 'hmiRecipes.exportCsv', defaultName: 'Batch A', text: 'x'}), null);
		assert.equal(await s.handle({action: 'hmiRecipes.importCsv'}), null);

		assert.equal(await s.handle({action: 'hmiAlarms.append', store: 'Plant', events: [ev('ALM', 'L', 'high')]}), 1);
		assert.equal(await s.handle({action: 'hmiAlarms.append', store: 'Plant', events: [ev('ALM', 'L', 'high')]}), 0);
		assert.equal((await s.handle({action: 'hmiAlarms.recent', store: 'Plant', limit: 10})).length, 1);

		await assert.rejects(s.handle({action: 7}), /bad request/);
	}
	finally
	{
		fs.rmSync(base, {recursive: true, force: true});
	}
});
