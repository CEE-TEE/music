import { MusicController } from "./lib/controller";

const SPOTIFY_NAME = "Spotify";
const ITUNES_NAME = "iTunes";

const musicCtr = new MusicController();

export async function isSpotifyRunning() {
    return await musicCtr.isMusicPlayerActive(SPOTIFY_NAME);
}

export async function isItunesRunning() {
    return await musicCtr.isMusicPlayerActive(ITUNES_NAME);
}

export async function stopSpotifyIfRunning() {
    return await musicCtr.stopPlayer(SPOTIFY_NAME);
}

export async function stopItunesIfRunning() {
    return await musicCtr.stopPlayer(ITUNES_NAME);
}

export async function startSpotifyIfNotRunning() {
    await musicCtr.startPlayer(SPOTIFY_NAME);
}

export async function startItunesIfNotRunning() {
    return await musicCtr.startPlayer(ITUNES_NAME);
}

/**
 * - Spotify does not return a "genre"
 * - duration is in milliseconds
 * @param player
 * @returns {artist, album, genre, disc_number, duration, played_count, track_number, id, name, state}
 */
export async function getState(player: string) {
    const state = await musicCtr.run(player, "state");
    if (state) {
        return JSON.parse(state);
    }
    return null;
}

/**
 *
 * @param player
 * @param params (e.g. ["spotify:track:0R8P9KfGJCDULmlEoBagcO", "spotify:album:6ZG5lRT77aJ3btmArcykra"]
 */
export function playTrackInContext(player: string, params: any[]) {
    return musicCtr.playTrackInContext(player, params);
}

//
// Sinngle line scripts that only require the player (Spotify or iTunes)
//

export function play(player: string) {
    return musicCtr.run(player, "play");
}

export function pause(player: string) {
    return musicCtr.run(player, "pause");
}

export function playPause(player: string) {
    return musicCtr.run(player, "playPause");
}

export function next(player: string) {
    return musicCtr.run(player, "next");
}

export function previous(player: string) {
    return musicCtr.run(player, "previous");
}
