// The addresses a browser can reach the server at, best first.

import os from 'os';

// Adapters of virtual machines, containers and VPNs: their addresses are not
// what a tablet on the plant network would use
const VIRTUAL = /docker|veth|virbr|vmnet|vboxnet|virtualbox|vmware|vethernet|hyper-v|wsl|br-[0-9a-f]|tailscale|zerotier|utun|tun\d|tap\d/i;

function isPrivate(ip)
{
	return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// interfaces: os.networkInterfaces()'s shape. Returns [{address, name}]:
// private LAN addresses on real adapters first, then other IPv4 addresses.
export function lanAddresses(interfaces = os.networkInterfaces())
{
	const found = [];

	for (const [name, list] of Object.entries(interfaces || {}))
	{
		for (const a of list || [])
		{
			const v4 = a.family === 'IPv4' || a.family === 4;

			if (v4 && !a.internal && !/^169\.254\./.test(a.address))
			{
				found.push({address: a.address, name: name,
					rank: (VIRTUAL.test(name) ? 2 : 0) + (isPrivate(a.address) ? 0 : 1)});
			}
		}
	}

	return found.sort((a, b) => a.rank - b.rank).map(({address, name}) => ({address, name}));
}

// The links to show for a server: [{url, label}], the one to share first.
// A local-only server is reachable from this computer alone.
export function serverLinks({port, localOnly, hostname = os.hostname(), interfaces})
{
	const links = [];
	const url = (host) => 'http://' + host + (port === 80 ? '' : ':' + port) + '/';

	if (!localOnly)
	{
		for (const a of lanAddresses(interfaces))
		{
			links.push({url: url(a.address), label: a.name});
		}

		if (hostname)
		{
			links.push({url: url(hostname.toLowerCase()), label: 'computer name'});
		}
	}

	// A local-only server listens on 127.0.0.1 alone, which localhost may not
	// resolve to first
	links.push({url: url(localOnly ? '127.0.0.1' : 'localhost'), label: 'this computer only'});

	return links;
}
