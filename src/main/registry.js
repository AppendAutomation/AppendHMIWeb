// The web servers running on this computer, whichever Append HMI Web process
// owns them (the launcher, or a --headless one), so the launcher can list,
// stop and restart them all.
//
// Each server has a file, userData/servers/<port>.json, readable by this user
// only: the owner's process id, the project, its settings and a random token
// that the server's control endpoint (server.js) requires. Entries whose
// process has gone are removed when the list is read.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function newToken()
{
	return crypto.randomBytes(24).toString('hex');
}

function alive(pid)
{
	try
	{
		process.kill(pid, 0);

		return true;
	}
	catch (e)
	{
		// EPERM: it exists but belongs to someone else
		return e.code === 'EPERM';
	}
}

export class ServerRegistry
{
	constructor(dir, pid = process.pid)
	{
		this.dir = dir;
		this.pid = pid;
	}

	file(port)
	{
		return path.join(this.dir, Number(port) + '.json');
	}

	// entry: {port, projectPath, name, view, localOnly, token}
	register(entry)
	{
		fs.mkdirSync(this.dir, {recursive: true, mode: 0o700});
		const data = Object.assign({}, entry, {pid: this.pid, startedAt: new Date().toISOString()});
		const tmp = this.file(entry.port) + '.' + this.pid + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {mode: 0o600});
		fs.renameSync(tmp, this.file(entry.port));
	}

	// Only the owner's own entry is removed
	unregister(port)
	{
		const e = this.read(this.file(port));

		if (e != null && e.pid === this.pid)
		{
			fs.rmSync(this.file(port), {force: true});
		}
	}

	read(file)
	{
		try
		{
			const e = JSON.parse(fs.readFileSync(file, 'utf8'));

			return e != null && Number.isInteger(e.port) && Number.isInteger(e.pid) && typeof e.token === 'string' ? e : null;
		}
		catch (e)
		{
			return null;
		}
	}

	// Every live entry, by port; stale ones are deleted
	list()
	{
		let names = [];

		try
		{
			names = fs.readdirSync(this.dir).filter(n => /^\d+\.json$/.test(n));
		}
		catch (e)
		{
			return [];
		}

		const out = [];

		for (const n of names)
		{
			const file = path.join(this.dir, n);
			const e = this.read(file);

			if (e == null || !alive(e.pid))
			{
				fs.rmSync(file, {force: true});
				continue;
			}

			out.push(e);
		}

		return out.sort((a, b) => a.port - b.port);
	}

	// The servers other processes own
	others()
	{
		return this.list().filter(e => e.pid !== this.pid);
	}
}
