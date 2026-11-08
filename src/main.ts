/**
 * The panel itself: everything it decides. How that looks is not decided here
 * any more — a Campus page draws it (`campus.ts`), with a bare list of its own
 * for when there is none (`fallback.ts`). This module keeps what has to stay
 * put in the pinned sha: the poll, the lines into the simulator, the feed names
 * for the editor, and the state the picture is drawn from.
 *
 * Four states, and the picture is always told which one it is in — a panel
 * that shows an empty list for "no program yet", "still connecting", "cannot get
 * through" and "the dashboard really is empty" alike would be worse than no
 * panel, because all four look like a broken dashboard.
 *
 * It only READS. The simulator's own datapoints go nowhere: there was a switch
 * here that posted them to the dashboard, removed because nothing on the board
 * could tell those readings from a real mini's (see `dashboard.ts`).
 */
import './style.css';
import {
	announceReady,
	listenToSimulator,
	refLabel,
	sendFeedsToEditor,
	sendToSimulator,
	type SimxAnnouncement
} from './simx';
import { simPage, watchValues, type DashboardView, type ReadFailure, type Value } from './dashboard';
import { CONTRACT_VERSION, readingKey, type IotSimView, type PanelStatus } from './contract';
import { createStage, DEFAULT_PAGE, devPage, originOf, type Build } from './campus';
import { renderFallback } from './fallback';

const app = document.getElementById('app') as HTMLElement;

let announcement: SimxAnnouncement | null = null;
let view: DashboardView | null = null;
let stopWatching: (() => void) | null = null;
/** The feed set last handed to the editor, so a poll that changed nothing posts nothing. */
let feedsPosted: string | null = null;

// ── Verbindung ────────────────────────────────────────────────────────────

/**
 * Failed polls in a row before the panel says so. One is a hiccup — a reloading
 * dev server, a dropped packet — and saying "no connection" for it would teach
 * the child to ignore the message; three is six seconds and no longer a blink.
 */
const FAILURES_BEFORE_SAYING = 3;
let failures = 0;
let failure: ReadFailure | null = null;
/** When a poll last answered: the moment the values on screen are from. */
let answeredAt = 0;

function cutOff(): boolean {
	return failures >= FAILURES_BEFORE_SAYING;
}

/** The editor's feed suggestions follow the dashboard (see `sendFeedsToEditor`). */
function postFeeds(v: DashboardView): void {
	const keys = Array.from(new Set(v.feeds.map((f) => f.key))).sort();
	const signature = keys.join('\n');
	if (signature === feedsPosted) return;
	feedsPosted = signature;
	sendFeedsToEditor(keys);
}

// ── Lesen: was auf dem Dashboard steht, geht zurück ins Programm ──────────
//
// Unconditional: reading is what the panel is for. A simulated mini that can
// see the board it is programmed against needs no switch — nothing leaves the
// machine, and the values were already on screen a line above.

/** Last reading seen per feed+from+to — only CHANGES go down the wire. */
const seen = new Map<string, string>();
/** The clock is sent once: a simulated mini does not reboot between polls. */
let clockPushed = false;
/**
 * When the panel saw each reading take its current value.
 *
 * NOT a server timestamp: `/read` answers with the last value per feed and
 * sender and carries no time for any of them (see `iot.pb.js`). So this says
 * the one thing that is actually known here — the poll at which this reading
 * appeared. A value that was already on the board when the panel connected has
 * no such moment, and gets no entry rather than borrowing the moment the panel
 * happened to start.
 */
const changedAt = new Map<string, number>();
let firstView = true;

function textOf(value: Value): string {
	return value.num === null ? value.str : String(value.num);
}

/**
 * One pass over a fresh snapshot, for the two things that care about CHANGE:
 * the lines that go down into the simulator, and the times the picture shows.
 * Both ask the same question — "is this reading new?" — and asking it in two
 * places would be two places for the answer to drift.
 */
function absorb(next: DashboardView): void {
	const lines: string[] = [];

	if (!clockPushed && next.clock > 0) {
		clockPushed = true;
		// Two lines, exactly as the campus relay splits them — the device's
		// serial buffer holds 20 bytes and `IOT1:t:<secs>:<tzo>` is one over.
		// The simulator has no such limit, but a second format for the same
		// fact is a second thing that can drift.
		lines.push(`IOT1:t:${next.clock}`);
		lines.push(`IOT1:z:${next.zone}`);
	}

	const now = Date.now();
	for (const value of next.values) {
		const key = readingKey(value);
		const text = textOf(value);
		if (seen.get(key) === text) continue;
		seen.set(key, text);
		if (!firstView) changedAt.set(key, now);
		lines.push(`IOT1:v:${value.from_dev || '0'}:${value.to_dev || ''}:${value.feed}:${text}`);
	}
	firstView = false;

	sendToSimulator(lines);
}

// ── Das Bild ──────────────────────────────────────────────────────────────

const stage = createStage(app, renderFallback);

/**
 * The origin trusted with the read token: the page the program's own server
 * named, or the local Campus in dev. Any other page — the default one drawing
 * for a foreign server — gets the slug only.
 */
let trustedOrigin = '';

/** The reference without its write token: the picture only ever reads. */
function readRef(ref: string): string {
	return ref
		.split(':')
		.filter((part) => !/^W-/i.test(part.trim()))
		.join(':');
}

function status(): PanelStatus {
	if (!announcement?.ref) return 'none';
	if (cutOff()) return 'cut-off';
	return view ? 'live' : 'connecting';
}

/** Hand the current state to whoever draws it. */
function render(): void {
	const state = status();
	const ref = announcement?.ref ?? '';
	const build: Build = (origin): IotSimView => ({
		type: 'iot-sim-view',
		v: CONTRACT_VERSION,
		state,
		view,
		changedAt: Object.fromEntries(changedAt),
		answeredAt,
		failure: cutOff() ? failure : null,
		ref: origin && origin === trustedOrigin ? readRef(ref) : refLabel(ref),
		server: announcement?.server ?? '',
		scope: announcement?.scope ?? 'dashboard'
	});
	stage.show(build);
}

/**
 * Which page draws. In dev always the local Campus; otherwise the one the
 * program's server names, or Campus's own when it names none. Counted, because
 * the answer comes late and a newer announcement may have overtaken it.
 */
let pageAsked = 0;
const dev = devPage();

async function choosePage(server: string): Promise<void> {
	if (dev) return;
	const asked = ++pageAsked;
	const page = server ? await simPage(server) : '';
	if (asked !== pageAsked) return;
	trustedOrigin = page ? originOf(page) : '';
	stage.load(page || DEFAULT_PAGE);
	render();
}

listenToSimulator({
	onAnnouncement: (next) => {
		// Only restart the watch when the ANSWER changes: the program repeats its
		// announcement on every reset, and tearing the poll down for an identical
		// one would blank the panel each time.
		// The SCOPE counts as part of the answer: a program that changes what it
		// subscribes to needs a different query, and treating that as "same"
		// would leave the panel asking the old question forever.
		const same =
			announcement?.ref === next.ref &&
			announcement?.server === next.server &&
			announcement?.scope === next.scope;
		const serverChanged = announcement?.server !== next.server;
		announcement = next;
		if (same) {
			// SAME QUERY, NEW PROGRAM. An announcement always means the program
			// started over — that is the only thing that emits one — so the panel
			// keeps its poll but must hand the fresh program the current state
			// again. Without this, a restarted simulator got NOTHING until some
			// other sender happened to write: `seen` still held every value from
			// before the reset, so the next poll found no change and pushed no
			// lines, and `wenn … empfangen` never fired on startup.
			//
			// The real device does not have this hole because campus forgets its
			// downlink cache on every hello (`forgetDeviceSession`) and re-states
			// clock and setpoints. This is the same promise, kept the same way.
			seen.clear();
			clockPushed = false;
			// Re-seeding is not "everything just changed": `firstView` keeps the
			// times off, so the picture does not mark every row on a reset.
			firstView = true;
			if (view) absorb(view);
			return;
		}

		if (serverChanged) void choosePage(next.server);
		stopWatching?.();
		view = null;
		seen.clear();
		changedAt.clear();
		firstView = true;
		clockPushed = false;
		feedsPosted = null;
		failures = 0;
		failure = null;
		answeredAt = 0;
		render();
		stopWatching = watchValues(
			next.server,
			next.ref,
			next.scope,
			(v) => {
				view = v;
				failures = 0;
				failure = null;
				answeredAt = Date.now();
				absorb(v);
				render();
				postFeeds(v);
			},
			(reason) => {
				failures++;
				failure = reason;
				render();
			}
		);
	}
});

// Listener first, THEN the handshake: pxt flushes everything it had held back
// the instant it sees `ready`, and a flush that lands before the listener is
// wired would take the announcement with it.
announceReady();

if (dev) trustedOrigin = originOf(dev);
stage.load(dev ?? DEFAULT_PAGE);
render();
