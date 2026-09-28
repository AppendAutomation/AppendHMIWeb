// What a browser's runtime asks of the server: the requests Append HMI
// Studio's main process answers for a published package (hmiRuntime.*,
// hmiComms.*, hmiAlarms.*, hmiRetentive.*, hmiUsers.*), answered here once
// per browser connection with Studio's own modules.
//
// Every connected browser runs the application for itself, like separate
// operator panels: its own PLC session, login and alarm acknowledgements.
// What they share is kept on the server: runtime user changes, retentive
// values and one alarm history, where an event reported by several browsers
// is written once (AlarmEvents).

import {publicRuntimeInfo, readRuntimeProject} from '../../studio/src/main/runtime/RuntimeMode.js';
import {CommsSession, validateCommsArgs} from '../../studio/src/main/comms/CommsSession.js';
import * as alarmLog from '../../studio/src/main/alarms/AlarmLog.js';
import * as retentiveStore from '../../studio/src/main/retentive/RetentiveStore.js';
import * as userStore from '../../studio/src/main/security/UserStore.js';

// Alarm events of one history, written once however many browsers report
// them. Every browser runs the application for itself, so each reports the
// alarms it sees, including ones already active when it opened. The history
// keeps each tag's alarm state and writes only real changes: an alarm (ALM)
// unless that condition is already active, a change (CHG) of condition, a
// return (RTN) only of an active alarm, one acknowledgement (ACK) per alarm.
export class AlarmEvents
{
	constructor()
	{
		this.tags = new Map();
	}

	fresh(events)
	{
		return (Array.isArray(events) ? events : []).filter((e) => e != null && this.accept(e));
	}

	accept(e)
	{
		const key = String(e.tag).toLowerCase();
		const s = this.tags.get(key);

		switch (e.event)
		{
			case 'ALM':
				if (s != null && s.active && s.condition === e.condition)
				{
					return false;
				}

				this.tags.set(key, {active: true, condition: e.condition, acked: false});
				return true;
			case 'CHG':
				if (s != null && s.active && s.condition === e.condition)
				{
					return false;
				}

				this.tags.set(key, {active: true, condition: e.condition, acked: s != null && s.acked});
				return true;
			case 'RTN':
				if (s != null && !s.active)
				{
					return false;
				}

				this.tags.set(key, {active: false, condition: null, acked: s != null && s.acked});
				return true;
			case 'ACK':
				if (s != null && s.acked)
				{
					return false;
				}

				this.tags.set(key, Object.assign({active: true, condition: e.condition}, s, {acked: true}));
				return true;
			default:
				return true;
		}
	}
}

// shared: {config, base (userData), supervisor() (hmi-comms), log, alarms
// (AlarmEvents), pruned (Set of alarm stores pruned this run)}. send(channel,
// data) pushes an event to this browser.
export class BrowserSession
{
	constructor(shared, send)
	{
		this.shared = shared;
		this.send = send;
		this.comms = null;
	}

	async handle(req)
	{
		const {config, base} = this.shared;
		const action = req.action;

		if (typeof action !== 'string')
		{
			throw new Error('bad request');
		}

		if (action.startsWith('hmiComms.'))
		{
			return this.handleComms(req);
		}

		switch (action)
		{
			case 'hmiRuntime.info':
				return Object.assign(publicRuntimeInfo(config), {error: config.error || null});
			case 'hmiRuntime.project':
				if (config.error != null) throw new Error(config.error);
				// Read each time, so a browser refresh picks up a saved change
				return {xml: await readRuntimeProject(config), title: publicRuntimeInfo(config).title};
			case 'hmiRuntime.exit':
				// A browser closes its tab; the server runs on
				return false;
			case 'hmiRuntime.log':
			{
				const level = ['info', 'warn', 'error'].includes(req.level) ? req.level : 'info';
				this.shared.log[level](config.productName + ' (browser): ' + String(req.message).slice(0, 2000));
				return null;
			}
			case 'hmiAlarms.append':
			{
				const store = alarmLog.storeName(req.store);
				const events = this.shared.alarms.fresh(req.events);
				const count = events.length > 0 ? await alarmLog.append(base, store, events) : 0;

				if (!this.shared.pruned.has(store))
				{
					this.shared.pruned.add(store);
					await alarmLog.prune(base, store, Date.now(), alarmLog.RETENTION_DAYS);
				}

				return count;
			}
			case 'hmiAlarms.recent':
				return alarmLog.recent(base, alarmLog.storeName(req.store), req.limit);
			case 'hmiRetentive.load':
				return retentiveStore.load(base, req.store);
			case 'hmiRetentive.save':
				return retentiveStore.save(base, req.store, req.values);
			case 'hmiUsers.load':
				return userStore.load(base, req.store);
			case 'hmiUsers.save':
				return userStore.save(base, req.store, req.users);
			case 'getDocumentsFolder':
			case 'isFullscreen':
			case 'isPluginsEnabled':
				return false;
			default:
				// The editor asks for things a browser runtime has no use for
				return null;
		}
	}

	async handleComms(req)
	{
		validateCommsArgs(req.action, req);

		if (req.action === 'hmiComms.disconnect')
		{
			this.close();

			return {ok: true};
		}

		if (this.comms == null)
		{
			this.comms = new CommsSession(this.shared.supervisor(), (ev) => this.send('hmiCommsEvent', ev));
		}

		const s = this.comms;

		switch (req.action)
		{
			case 'hmiComms.configure':
				return s.configure(req.devices, req.tags);
			case 'hmiComms.subscribe':
				return s.subscribe(req.ids, req.rateMs, req.rates);
			case 'hmiComms.unsubscribe':
				return s.unsubscribe();
			case 'hmiComms.read':
				return s.read(req.ids);
			case 'hmiComms.write':
				return s.write(req.values, req.timeoutMs);
			case 'hmiComms.status':
				return s.status();
			case 'hmiComms.diag':
				return s.diag();
			default:
				throw new Error('not available in a browser');
		}
	}

	close()
	{
		if (this.comms != null)
		{
			this.comms.close();
			this.comms = null;
		}
	}
}
