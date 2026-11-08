/**
 * Who draws the panel: a Campus page in a nested iframe, or, while there is
 * none, the small list in `fallback.ts`.
 *
 * WHY A PAGE. This panel is pinned by sha in the target, so every change to
 * how it looks used to cost a gh-pages commit, a sha bump in pxt-calliope and a
 * target redeploy. The page ships with every Campus release instead. What stays
 * here is what must not move with Campus deploys: the poll, the lines into the
 * simulator, the feed names for the editor (`main.ts`).
 *
 * WHY A FALLBACK. MakeCode without Campus must keep a working panel: offline,
 * a school network that blocks Campus, a Campus that is down. If the page has
 * not said it is ready within `FALLBACK_AFTER_MS`, the fallback draws; if the
 * page says so later, it takes over.
 *
 * WHO IS LISTENED TO. Only the frame this module made, and only from the origin
 * it was loaded from. And it can say exactly one thing, "ready"; nothing it
 * sends reaches the simulator (`listenToSimulator` hears only the editor).
 */
import type { IotSimView } from './contract';

/** Long enough for Campus to load on a slow school network, short enough not to look broken. */
const FALLBACK_AFTER_MS = 3000;

/** The page when the program's server names none (an older Campus, a foreign server, no program yet). */
export const DEFAULT_PAGE = 'https://campus.calliope.cc/embed/iot-sim';

/** Where a local Campus runs by default (its Vite dev server). */
const DEV_CAMPUS = 'https://localhost:5173';

/**
 * The local Campus's page when the panel itself is served from localhost —
 * which is what MakeCode's `simxdev` does (the targetconfig's `devUrl`). There
 * the developer's own Campus draws, whatever the program's server would name.
 *
 * `?campus=<origin>` on the panel's URL picks another one (Campus workspaces
 * run on other ports), then `VITE_CAMPUS_ORIGIN`, then `DEV_CAMPUS`. Only here:
 * a published panel cannot be pointed elsewhere by its URL.
 */
export function devPage(): string | null {
	const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
	if (!import.meta.env.DEV && !local) return null;
	const origin =
		new URLSearchParams(location.search).get('campus') ||
		import.meta.env.VITE_CAMPUS_ORIGIN ||
		DEV_CAMPUS;
	try {
		const url = new URL('/embed/iot-sim', origin);
		return /^https?:$/.test(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

export function originOf(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return '';
	}
}

type Frame = { el: HTMLIFrameElement; url: string; origin: string; ready: boolean };

/** The message for a page of the given origin ('' for the fallback). */
export type Build = (origin: string) => IotSimView;

export type Stage = {
	/** Draw with this page. The page already drawing or loading: nothing happens. */
	load(url: string): void;
	/** The state changed: tell the page, or redraw the fallback while it draws. */
	show(build: Build): void;
};

export function createStage(
	root: HTMLElement,
	fallback: (el: HTMLElement, state: IotSimView) => void
): Stage {
	const fallbackEl = document.createElement('div');
	fallbackEl.className = 'fallback';
	fallbackEl.hidden = true;
	root.append(fallbackEl);

	/** The page on screen; it has said it is ready. */
	let shown: Frame | null = null;
	/** A page still loading, hidden until it says it is ready. */
	let pending: Frame | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let build: Build | null = null;

	const drawFallback = () => {
		if (!fallbackEl.hidden && build) fallback(fallbackEl, build(''));
	};

	const send = (frame: Frame) => {
		if (!frame.ready || !build) return;
		// To the page's origin, never '*': the message carries the read token.
		frame.el.contentWindow?.postMessage(build(frame.origin), frame.origin);
	};

	const load = (url: string) => {
		if ((pending ?? shown)?.url === url) return;
		pending?.el.remove();
		const el = document.createElement('iframe');
		el.title = 'IoT-Dashboard';
		el.hidden = true;
		el.src = url;
		root.append(el);
		pending = { el, url, origin: originOf(url), ready: false };
		clearTimeout(timer);
		// A page that drew before keeps drawing while the next one loads, and
		// past the deadline too: it is still Campus's look, only another
		// Campus's. The fallback is for when there is no page at all.
		timer = setTimeout(() => {
			if (shown) return;
			fallbackEl.hidden = false;
			drawFallback();
		}, FALLBACK_AFTER_MS);
	};

	addEventListener('message', (event: MessageEvent) => {
		const msg = event.data as { type?: unknown } | null;
		if (!msg || typeof msg !== 'object' || msg.type !== 'iot-sim-ready') return;
		const frame = [pending, shown].find(
			(f) => f && event.source === f.el.contentWindow && event.origin === f.origin
		);
		if (!frame) return;
		frame.ready = true;
		if (frame === pending) {
			clearTimeout(timer);
			shown?.el.remove();
			shown = frame;
			pending = null;
			frame.el.hidden = false;
			fallbackEl.hidden = true;
		}
		// Every time, not just the first: a page that reloads (a Campus deploy,
		// a dev server's hot reload) starts empty and asks again.
		send(frame);
	});

	return {
		load,
		show(next) {
			build = next;
			if (shown) send(shown);
			drawFallback();
		}
	};
}
