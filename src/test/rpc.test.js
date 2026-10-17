import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {AlarmEvents, BrowserSession} from '../main/rpc.js';
import {TrendRecorders} from '../../studio/src/main/trends/TrendLog.js';
import * as codes from '../../studio/src/main/sql/ResultCodes.js';

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

test('a browser has its own database connections, closed when it goes', async () =>
{
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-sql-'));

	try
	{
		const shared = {config: {productName: 'Plant'}, base: base, documents: null,
			supervisor: () => null, log: {info() {}, warn() {}, error() {}}};
		const one = new BrowserSession(shared, () => {});
		const two = new BrowserSession(shared, () => {});
		const source = {name: 'Demo', provider: 'sqlite', file: 'rpc.db'};

		const opened = await one.handle({action: 'hmiSql.connect', dataSource: source, store: 'Plant'});
		assert.equal(opened.code, 0, JSON.stringify(opened));
		assert.equal(opened.connectionId, 1);

		const made = await one.handle({action: 'hmiSql.exec', connectionId: 1,
			sql: 'CREATE TABLE Batches (Name text, Weight real)'});
		assert.equal(made.code, 0, JSON.stringify(made));

		await one.handle({action: 'hmiSql.exec', connectionId: 1,
			sql: 'INSERT INTO Batches (Name, Weight) VALUES (?, ?)',
			params: [{type: 'varchar', value: 'Blue'}, {type: 'double', value: 12.5}]});

		const rows = await one.handle({action: 'hmiSql.exec', connectionId: 1,
			sql: 'SELECT Name, Weight FROM Batches'});
		assert.equal(rows.code, 0);
		assert.deepEqual(rows.rows, [['Blue', 12.5]]);

		// Each browser runs the application for itself: a connection one
		// opened is not a number another can address
		const notYours = await two.handle({action: 'hmiSql.connect', dataSource: source, store: 'Plant'});
		assert.equal(notYours.connectionId, 1, 'numbering starts afresh per browser');

		// A rolled-back transaction leaves nothing behind
		assert.equal((await two.handle({action: 'hmiSql.begin', connectionId: 1})).code, 0);
		await two.handle({action: 'hmiSql.exec', connectionId: 1,
			sql: "INSERT INTO Batches (Name, Weight) VALUES ('Gone', 1)"});
		assert.equal((await two.handle({action: 'hmiSql.rollback', connectionId: 1})).code, 0);
		assert.equal((await two.handle({action: 'hmiSql.exec', connectionId: 1,
			sql: 'SELECT COUNT(*) FROM Batches'})).rows[0][0], 1);

		// Closing the browser closes its connections, and the numbers it was
		// given answer no longer
		two.close();
		assert.equal((await two.handle({action: 'hmiSql.exec', connectionId: 1,
			sql: 'SELECT 1'})).code, codes.INVALID_CONNECTION);

		// The editor's own requests have no answer here
		await assert.rejects(one.handle({action: 'hmiSql.probe', dataSource: source}),
			/not available in a browser/);
		await assert.rejects(one.handle({action: 'hmiSql.overrides', store: 'Plant'}),
			/not available in a browser/);
		await assert.rejects(one.handle({action: 'hmiSql.exec', connectionId: 0, sql: 'SELECT 1'}),
			/bad arg: connectionId/);

		one.close();
	}
	finally
	{
		fs.rmSync(base, {recursive: true, force: true});
	}
});

test('a browser session keeps runtime users and retentive values on the server', async () =>
{
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-web-rpc-'));

	try
	{
		const file = path.join(base, 'Plant.ahmi');
		fs.writeFileSync(file, '<mxfile/>');
		const shared = {config: {projectPath: file, productName: 'Plant', version: '', windowMode: 'kiosk', exit: {mode: 'shortcut'}},
			base: base, supervisor: () => null, log: {info() {}, warn() {}, error() {}}, alarms: new AlarmEvents(), pruned: new Set(),
			trends: new TrendRecorders(), prunedTrends: new Map()};
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

		// One trend history: one browser records it until it closes
		const s2 = new BrowserSession(shared, () => {});
		const t = Date.now();
		assert.equal(await s.handle({action: 'hmiTrends.append', store: 'Plant', samples: [[t, 'Level', 5]]}), 1);
		assert.equal(await s2.handle({action: 'hmiTrends.append', store: 'Plant', samples: [[t + 1, 'Level', 6]]}), 0);
		assert.deepEqual(await s2.handle({action: 'hmiTrends.query', store: 'Plant', tags: ['Level'], from: t - 1000, to: t + 1000}),
			{Level: [[t, 5]]});
		s.close();
		assert.equal(await s2.handle({action: 'hmiTrends.append', store: 'Plant', samples: [[t + 2, 'Level', 7]]}), 1);

		await assert.rejects(s.handle({action: 7}), /bad request/);
	}
	finally
	{
		fs.rmSync(base, {recursive: true, force: true});
	}
});
