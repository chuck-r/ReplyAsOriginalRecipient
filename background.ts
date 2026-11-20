// SPDX-License-Identifier: GPL-3.0-only
(function (tb: ThunderbirdAPI)
{
	'use strict';

	const verbose = 0;

	const on_compose_start = async (tab: Tab, win: TWindow) =>
	{
		// Allow Thunderbird to finish initializing compose details.
		await sleep(10);

		if (!tab.id) { return; }

		let msg = await tb.compose.getComposeDetails(tab.id);
		log.info('on_compose_start', json2({
			tab: { id: tab.id, win_id: tab.windowId, url: tab.url, status: tab.status },
			win: { id: win.id, type: win.type },
			details: msg
		}));

		if (is_new(msg)) { return; }

		// Recipients are not always available immediately.
		const waits = [1, 10, 25, 50, 100, 100, 100, 100];
		for (let i = 0; i < waits.length && !(msg.to || []).length && !(msg.cc || []).length; i++)
		{
			await sleep(waits[i]!);
			msg = await tb.compose.getComposeDetails(tab.id);
		}
		log.info('final details', json2(msg));

		if (is_reply(msg))
		{
			await set_original_recipient_as_from(tab.id, msg);
			msg = await tb.compose.getComposeDetails(tab.id);
		}

		// Preserve the original focus workaround.
		for (const delay of [0, 1, 10, 10])
		{
			if (delay) await sleep(delay);
			try
			{
				const isFocusSet = await set_compose_focus(
					tab.id,
					(is_reply(msg) && 'body') || (!(msg.to || []).length && 'to') || 'body',
					{ msg }
				);
				if (isFocusSet === true)
				{
					break;
				}
			}
			catch (error)
			{
				// nothing
			}
		}

	};

	/**
	 * Set the From address to the actual address to which the original
	 * message was delivered. This deliberately does not rewrite plus or
	 * hyphen aliases and does not guess from domains or configured identities.
	 */
	const set_original_recipient_as_from = async (tabId: TabId, composeMsg: ComposeDetails) =>
	{
		let oriMsg = null;

		try
		{
			oriMsg = await tb.messages.getFull(composeMsg.relatedMessageId!);
		} catch (error)
		{
			log.warn('Could not load original message:', error);
			return;
		}

		if (!oriMsg || !oriMsg.headers)
		{
			log.warn('Original message or its headers are unavailable; leaving From unchanged.');
			return;
		}

		const headers = oriMsg.headers;
		log.info('original message headers', json2(headers));

		// Prefer the delivery header added by many forwarding/catch-all setups.
		const originalToHeader = firstHeaderValue(headers['x-original-to'] ?? null);
		const toHeader = firstHeaderValue(headers['to'] ?? null);

		let originalRecipient = parseMailbox(originalToHeader);

		// Fall back to To only when it contains exactly one unambiguous mailbox.
		if (!originalRecipient && toHeader)
		{
			const recipients = splitMailboxList(toHeader);
			if (recipients.length === 1)
			{
				originalRecipient = parseMailbox(recipients[0]!);
			} else
			{
				log.warn('No X-Original-To header and To contains multiple recipients; leaving From unchanged.');
			}
		}

		if (!originalRecipient || !isEmailAddress(originalRecipient.email))
		{
			log.warn('Could not determine a valid original recipient; leaving From unchanged.');
			return;
		}

		// Keep a useful display name if the delivery header has no name.
		if (!originalRecipient.name && toHeader)
		{
			const recipients = splitMailboxList(toHeader);
			if (recipients.length === 1)
			{
				const toRecipient = parseMailbox(recipients[0]!);
				if (toRecipient && toRecipient.email.toLowerCase() === originalRecipient.email.toLowerCase())
				{
					originalRecipient.name = toRecipient.name || '';
				}
			}
		}

		const from = formatMailbox(originalRecipient);
		log.info('Setting reply From to original recipient:', from);

		try
		{
			await tb.compose.setComposeDetails(tabId, { from });
		} catch (error)
		{
			log.error('Could not set reply From address:', error);
		}
	};

	const firstHeaderValue = (value: string[] | string | null) =>
	{
		if (Array.isArray(value)) return value.length ? String(value[0]) : '';
		return value == null ? '' : String(value);
	};

	/**
	 * Parse a single RFC-style mailbox in the common Thunderbird header form:
	 * Display Name <address@example.org> or address@example.org.
	 */
	const parseMailbox = (value: string): Mailbox | null =>
	{
		if (typeof value !== 'string') return null;

		const input = value.trim();
		if (!input) return null;

		const match = input.match(/^(.*?)\s*<\s*([^<>]+)\s*>\s*$/);
		if (match)
		{
			return {
				name: cleanDisplayName(match[1]!),
				email: match[2]!.trim()
			};
		}

		// Bare address; do not accept arbitrary header text.
		if (isEmailAddress(input))
		{
			return { name: '', email: input };
		}

		return null;
	};

	const cleanDisplayName = (name: string) =>
	{
		let result = (name || '').trim();
		if (result.length >= 2 && result.startsWith('"') && result.endsWith('"'))
		{
			result = result.slice(1, -1).replace(/\\"/g, '"');
		}
		return result;
	};

	const isEmailAddress = (value: string) =>
	{
		if (typeof value !== 'string') return false;
		const email = value.trim();
		// Conservative validation: enough to reject malformed/header fragments
		// without trying to implement the entire RFC email grammar.
		return /^[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+$/.test(email);
	};

	/**
	 * Split a To header into mailboxes without splitting commas inside
	 * quoted display names or angle brackets.
	 */
	const splitMailboxList = (value: string) =>
	{
		if (typeof value !== 'string' || !value.trim()) return [];

		const result = [];
		let current = '';
		let inQuotes = false;
		let escaped = false;
		let angleDepth = 0;

		for (const char of value)
		{
			if (escaped)
			{
				current += char;
				escaped = false;
				continue;
			}
			if (char === '\\' && inQuotes)
			{
				current += char;
				escaped = true;
				continue;
			}
			if (char === '"') inQuotes = !inQuotes;
			if (!inQuotes)
			{
				if (char === '<') angleDepth++;
				if (char === '>' && angleDepth > 0) angleDepth--;
				if (char === ',' && angleDepth === 0)
				{
					if (current.trim()) result.push(current.trim());
					current = '';
					continue;
				}
			}
			current += char;
		}

		if (current.trim()) result.push(current.trim());
		return result;
	};

	const formatMailbox = (mailbox: Mailbox) =>
	{
		const email = mailbox.email.trim();
		const name = (mailbox.name || '').trim();
		return name ? `${name} <${email}>` : `<${email}>`;
	};

	const set_compose_focus = async (tab_id: TabId, target: "to" | "cc" | "bcc" | "body", opt: { msg?: ComposeDetails }) =>
	{
		log.info(`setting compose focus to '${target}'`);
		if (target === 'to' || target === 'cc' || target === 'bcc')
		{
			let msg = opt && opt.msg;
			if (!msg) msg = await tb.compose.getComposeDetails(tab_id);
			const orig_v = msg[target] || [];
			//await tb.compose.setComposeDetails(tab_id, { [target]: [...orig_v, 'x'] });
			await tb.compose.setComposeDetails(tab_id, { [target]: orig_v });
			return true;
		}
		else if (target === 'body')
		{
			await tb.tabs.executeScript(tab_id, { code: 'window.focus()' });
			return true;
		}
		else
		{
			throw new Error('Invalid focus target: ' + target);
		}
	};

	// The type field was added in Thunderbird 88.
	// Before that, detect replies by the "Re: " subject prefix.
	const is_reply = (msg: ComposeDetails) =>
	{
		if (msg && msg.type) return msg.type === 'reply';
		return !!(msg && (msg.subject || '').startsWith('Re: '));
	};

	const is_new = (msg: ComposeDetails) =>
	{
		if (msg && msg.type) return msg.type === 'new';
		return !msg || !msg.subject;
	};

	tb.tabs.onCreated.addListener(async (tab) =>
	{
		log.trace('tabs.onCreated', tab);
		const win = await tb.windows.get(tab.windowId!);
		if (win && win.type === 'messageCompose') on_compose_start(tab, win);
	});

	tb.tabs.onUpdated.addListener((tab_id, changes, tab) =>
	{
		log.trace('tabs.onUpdated', { tab_id, changes, tab });
	});

	tb.windows.onCreated.addListener(async win =>
	{
		if (win.type !== 'messageCompose') return;

		const win_tabs = await tb.tabs.query({ windowId: win.id! });
		log.trace('win_tabs', win_tabs);

		if (win_tabs.length)
		{
			if (win_tabs.length > 1) log.warn('compose window has multiple tabs:', win_tabs);
			on_compose_start(win_tabs[win_tabs.length - 1]!, win);
		}
	});

	// -- utilities --

	const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
	const json2 = (value: object) => JSON.stringify(value, null, 2);

	const log = (conf: LogType | { cfn: LogType, verbose?: number }, ...args: unknown[]) =>
	{
		if (typeof conf === 'string') conf = { cfn: conf };
		if (conf.verbose && verbose < conf.verbose) return;
		console[conf.cfn || 'log'](...args);
	};

	log.error = log.bind(log, { cfn: 'error' });
	log.warn = log.bind(log, { cfn: 'warn' });
	log.info = log.bind(log, { cfn: 'log', verbose: 1 });
	log.debug = log.bind(log, { cfn: 'debug', verbose: 2 });
	log.trace = log.bind(log, { cfn: 'debug', verbose: 3 });

})(messenger);