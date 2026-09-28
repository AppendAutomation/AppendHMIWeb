import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lanAddresses, serverLinks} from '../main/network.js';

const v4 = (address, internal = false) => ({family: 'IPv4', address, internal});

const interfaces = {
	lo: [v4('127.0.0.1', true)],
	docker0: [v4('172.17.0.1')],
	'vEthernet (WSL)': [v4('172.28.64.1')],
	eth0: [v4('192.168.1.20'), {family: 'IPv6', address: 'fe80::1', internal: false}],
	wlan0: [v4('169.254.10.2')],
	eth1: [v4('203.0.113.5')]
};

test('LAN addresses on real adapters come first', () =>
{
	assert.deepEqual(lanAddresses(interfaces).map(a => a.address), ['192.168.1.20', '203.0.113.5', '172.17.0.1', '172.28.64.1']);
});

test('the links: the LAN address first, then the computer name, then this computer', () =>
{
	const links = serverLinks({port: 8480, localOnly: false, hostname: 'PANEL-1', interfaces});
	assert.equal(links[0].url, 'http://192.168.1.20:8480/');
	assert.equal(links[0].label, 'eth0');
	assert.ok(links.some(l => l.url === 'http://panel-1:8480/'));
	assert.equal(links[links.length - 1].url, 'http://localhost:8480/');
});

test('a local-only server has only its own link', () =>
{
	assert.deepEqual(serverLinks({port: 9000, localOnly: true, hostname: 'x', interfaces}).map(l => l.url), ['http://127.0.0.1:9000/']);
});

test('port 80 needs no port in the link', () =>
{
	assert.equal(serverLinks({port: 80, localOnly: true, interfaces: {}})[0].url, 'http://127.0.0.1/');
});

test('without a network there is still this computer', () =>
{
	assert.deepEqual(serverLinks({port: 8480, localOnly: false, hostname: '', interfaces: {lo: [v4('127.0.0.1', true)]}})
		.map(l => l.url), ['http://localhost:8480/']);
});
