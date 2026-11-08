/**
 * The panel's own picture, for when no Campus page draws it (see `campus.ts`):
 * MakeCode offline, behind a network that blocks Campus, or with Campus down.
 *
 * Deliberately the bare minimum of what the Campus page shows: the four states,
 * and per feed its name and current reading. No table of senders, no font of
 * its own — this is the panel still working, not the panel's look. The look is
 * Campus's, and every line of it here would be a line that can only change with
 * a new sha.
 */
import { refLabel } from './simx';
import type { IotSimView } from './contract';
import type { ReadFailure, Value } from './dashboard';

function hostOf(server: string): string {
	return server
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
		.replace(/\/.*$/, '');
}

/** What to check, in the words of the blocks rather than of HTTP. */
function advice(reason: ReadFailure | null, state: IotSimView): string {
	const host = hostOf(state.server) || 'Der Server';
	switch (reason) {
		case 'address':
			return 'Das Programm nennt keine gültige Server-Adresse. Prüfe die Adresse in den IoT-Blöcken.';
		case 'refused':
			return `${host} kennt das Dashboard „${refLabel(state.ref)}“ nicht. Prüfe den Namen oder Schlüssel im Dashboard-Block.`;
		default:
			return `${host} antwortet nicht. Prüfe die Server-Adresse im Programm und ob das Dashboard erreichbar ist.`;
	}
}

function textOf(value: Value): string {
	return value.num === null ? value.str : String(value.num);
}

function clock(at: number): string {
	const time = new Date(at);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}

function escape(text: string): string {
	return String(text).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);
}

function empty(title: string, text = ''): string {
	return `<section class="empty"><h1>${escape(title)}</h1>${text ? `<p>${escape(text)}</p>` : ''}</section>`;
}

export function renderFallback(el: HTMLElement, state: IotSimView): void {
	if (state.state === 'none') {
		el.innerHTML = empty(
			'Kein Dashboard',
			'Starte ein Programm mit den IoT-Blöcken im Simulator. Es muss ein Dashboard nennen — dann zeigt dieses Feld, was darauf steht.'
		);
		return;
	}
	if (!state.view) {
		el.innerHTML =
			state.state === 'cut-off'
				? empty('Keine Verbindung zum Dashboard', advice(state.failure, state))
				: empty('Verbinde…');
		return;
	}

	// `/read` answers newest first, so the first value of a feed is its current
	// one; the feeds go alphabetically, so none swaps places while watched.
	const current = new Map<string, Value>();
	for (const value of state.view.values) if (!current.has(value.feed)) current.set(value.feed, value);
	const rows = [...current.values()]
		.sort((a, b) => a.feed.localeCompare(b.feed))
		.map(
			(v) =>
				`<li><span class="name">${escape(v.feed)}</span><span class="val">${escape(textOf(v))}</span></li>`
		)
		.join('');

	const stale = state.state === 'cut-off';
	const header = stale
		? `<p class="offline">Keine Verbindung · Stand ${clock(state.answeredAt)}</p>`
		: '';
	el.innerHTML = `${header}${
		rows ? `<ul class="feeds${stale ? ' stale' : ''}">${rows}</ul>` : empty('Noch keine Werte.')
	}`;
}
