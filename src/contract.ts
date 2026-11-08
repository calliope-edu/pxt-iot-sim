/**
 * What the panel tells the Campus page that draws it, and what the page says
 * back. The README spells the same contract out for the Campus side.
 *
 * The panel (this repository) is pinned by sha in the target and stays pinned in
 * every target version that ever shipped it. The page ships with every Campus
 * release. So the contract can only GROW: Campus may read new fields once a
 * newer panel sends them, but must keep drawing what an old panel sends, and the
 * panel must never stop sending a field or change what one means. A break would
 * not show up as an error anywhere; it would show up as old MakeCode versions
 * drawing an empty panel.
 */
import type { DashboardView, ReadFailure } from './dashboard';

export const CONTRACT_VERSION = 1;

/**
 * The four things the panel can be doing, told apart for the same reason the
 * panel always told them apart: an empty list for all four would look like a
 * broken dashboard every time.
 *
 *   none        no program has named a dashboard yet
 *   connecting  a program has, and no answer has come yet
 *   cut-off     several polls in a row failed; `view` still holds the last
 *               answer if there ever was one, `answeredAt` says from when
 *   live        the last poll answered
 */
export type PanelStatus = 'none' | 'connecting' | 'cut-off' | 'live';

/** Shell → page, on every change and again whenever the page says it is ready. */
export type IotSimView = {
	type: 'iot-sim-view';
	v: typeof CONTRACT_VERSION;
	state: PanelStatus;
	/** The last answer of `/read`, or null before the first one. */
	view: DashboardView | null;
	/**
	 * When the panel saw each reading take its current value, in ms since the
	 * epoch, keyed by `readingKey`. A reading that was already on the board when
	 * the panel connected has no entry: there is no moment to tell.
	 */
	changedAt: Record<string, number>;
	/** When a poll last answered, ms since the epoch; 0 if none has. */
	answeredAt: number;
	/** Why the last poll failed, while it keeps failing; null otherwise. */
	failure: ReadFailure | null;
	/**
	 * The dashboard the program names, without its write token (the page only
	 * reads). Slug and read token when the page is the one the program's own
	 * server names; only the slug otherwise, because then the page belongs to
	 * somebody else than the token does.
	 */
	ref: string;
	/** The server the program names (`IOT1:s:`), as it named it. */
	server: string;
	/** Whose values the program reads: dashboard | devices | all. */
	scope: string;
};

/** Page → shell, once it listens. The shell answers with the current state. */
export type IotSimReady = { type: 'iot-sim-ready'; v: number };

/** A reading is one feed, one sender, one recipient; that triple is its name. */
export function readingKey(value: { feed: string; from_dev: string; to_dev: string }): string {
	return `${value.feed} ${value.from_dev || '0'} ${value.to_dev || ''}`;
}
