import { MusicUtil } from "./util";
import { MusicController } from "./controller";
import { MusicStore } from "./store";
import { MusicClient } from "./client";
import { CacheUtil } from "./cache";
import {
    PlayerDevice,
    Track,
    PlayerType,
    PlayerContext,
    TrackStatus,
    Artist,
    PlayerName
} from "./models";
import { AudioStat } from "./audiostat";

const musicStore = MusicStore.getInstance();
const musicClient = MusicClient.getInstance();
const cacheUtil = CacheUtil.getInstance();
const audioStat = AudioStat.getInstance();
const musicController = MusicController.getInstance();
const musicUtil = new MusicUtil();

export const SPOTIFY_LIKED_SONGS_PLAYLIST_NAME = "Liked Songs";

export class MusicPlayerState {
    private static instance: MusicPlayerState;
    private constructor() {
        //
    }
    static getInstance() {
        if (!MusicPlayerState.instance) {
            MusicPlayerState.instance = new MusicPlayerState();
        }
        return MusicPlayerState.instance;
    }

    async isWindowsSpotifyRunning(): Promise<boolean> {
        /**
         * /tasklist /fi "imagename eq Spotify.exe" /fo list /v |find " - "
         * Window Title: Dexys Midnight Runners - Come On Eileen
         */
        let result = await musicUtil
            .execCmd(MusicController.WINDOWS_SPOTIFY_TRACK_FIND)
            .catch(e => {
                // console.log(
                //     "Error trying to identify if spotify is running on windows: ",
                //     e.message
                // );
                return null;
            });
        if (result && result.toLowerCase().includes("title")) {
            return true;
        }
        return false;
    }

    async isSpotifyWebRunning(): Promise<boolean> {
        let accessToken = musicStore.spotifyAccessToken;
        if (accessToken) {
            let spotifyDevices: PlayerDevice[] = await this.getSpotifyDevices();
            if (spotifyDevices.length > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * returns...
     * {
        "devices" : [ {
            "id" : "5fbb3ba6aa454b5534c4ba43a8c7e8e45a63ad0e",
            "is_active" : false,
            "is_private_session": true,
            "is_restricted" : false,
            "name" : "My fridge",
            "type" : "Computer",
            "volume_percent" : 100
        } ]
        }
     */
    async getSpotifyDevices(
        skipCache: boolean = false
    ): Promise<PlayerDevice[]> {
        let devices: PlayerDevice[] = cacheUtil.getItem("devices");
        if (devices && !skipCache) {
            // return the value from cache
            return devices;
        }

        const api = "/v1/me/player/devices";
        let response = await musicClient.spotifyApiGet(api);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }
        if (response.data && response.status === 200 && response.data.devices) {
            devices = response.data.devices;
            if (devices) {
                cacheUtil.setItem("devices", devices, 20 /* second */);
            }
        } else {
            devices = [];
        }

        // cache these results for a minute
        return devices || [];
    }

    /**
     * returns i.e.
     * track = {
            artist: 'Bob Dylan',
            album: 'Highway 61 Revisited',
            disc_number: 1,
            duration: 370,
            played count: 0,
            track_number: 1,
            starred: false,
            popularity: 71,
            id: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc',
            name: 'Like A Rolling Stone',
            album_artist: 'Bob Dylan',
            artwork_url: 'http://images.spotify.com/image/e3d720410b4a0770c1fc84bc8eb0f0b76758a358',
            spotify_url: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc' }
        }
    */
    async getWindowsSpotifyTrackInfo() {
        let windowTitleStr = "Window Title:";
        // get the artist - song name from the command result, then get the rest of the info from spotify
        let songInfo = await musicUtil
            .execCmd(MusicController.WINDOWS_SPOTIFY_TRACK_FIND)
            .catch(e => {
                // console.log(
                //     "Error trying to identify if spotify is running on windows: ",
                //     e.message
                // );
                return null;
            });
        if (!songInfo || !songInfo.includes(windowTitleStr)) {
            // it must have paused, or an ad, or it was closed
            return null;
        }
        // fetch it from spotify
        // result will be something like: "Window Title: Dexys Midnight Runners - Come On Eileen"
        songInfo = songInfo.substring(windowTitleStr.length);
        let artistSong = songInfo.split("-");
        let artist = artistSong[0].trim();
        let song = artistSong[1].trim();

        const qParam = encodeURIComponent(`artist:${artist} track:${song}`);
        const qryStr = `q=${qParam}&type=track&limit=2&offset=0`;
        let api = `/v1/search?${qryStr}`;
        let resp = await musicClient.spotifyApiGet(api);
        let trackInfo = null;
        if (
            musicUtil.isResponseOk(resp) &&
            resp.data &&
            resp.data.tracks &&
            resp.data.tracks.items
        ) {
            trackInfo = resp.data.tracks.items[0];
            // set the other attributes like start and type
            trackInfo["type"] = "spotify";
            trackInfo["state"] = "playing";
            trackInfo["start"] = 0;
            trackInfo["end"] = 0;
            trackInfo["genre"] = "";
        }

        return trackInfo;
    }

    async getSpotifyTrackById(
        id: string,
        includeArtistData: boolean = false,
        includeAudioFeaturesData: boolean = false,
        includeGenre: boolean = false
    ): Promise<Track> {
        id = musicUtil.createSpotifyIdFromUri(id);
        let track: Track;
        let api = `/v1/tracks/${id}`;

        let response = await musicClient.spotifyApiGet(api);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }

        if (response && response.status === 200 && response.data) {
            track = this.copySpotifyTrackToCodyTrack(response.data);

            // get the arist data
            if (includeArtistData && track.artists) {
                let artists: Artist[] = [];

                for (let i = 0; i < track.artists.length; i++) {
                    const artist = track.artists[i];
                    const artistData: Artist = await this.getSpotifyArtistById(
                        artist.id
                    );
                    artists.push(artistData);
                }
                if (artists.length > 0) {
                    track.artists = artists;
                } else {
                    track.artists = [];
                }
            }

            if (!track.genre && includeGenre) {
                // first check if we have an artist in artists
                // artists[0].genres[0]
                let genre = "";
                if (
                    track.artists &&
                    track.artists.length > 0 &&
                    track.artists[0].genres
                ) {
                    genre = track.artists[0].genres.join(" ");
                }
                if (!genre) {
                    // get the genre
                    genre = await musicController.getGenre(
                        track.artist,
                        track.name
                    );
                }
                if (genre) {
                    track.genre = genre;
                }
            }

            // get the features
            if (includeAudioFeaturesData) {
                const spotifyAudioFeatures = await audioStat.getSpotifyAudioFeatures(
                    [id]
                );
                if (spotifyAudioFeatures && spotifyAudioFeatures.length > 0) {
                    track.features = spotifyAudioFeatures[0];
                }
            }
        } else {
            track = new Track();
        }

        return track;
    }

    async getSpotifyArtistById(id: string): Promise<Artist> {
        let artist: Artist;

        id = musicUtil.createSpotifyIdFromUri(id);

        // check the cache first
        artist = cacheUtil.getItem(`artist_${id}`);
        if (!artist) {
            let api = `/v1/artists/${id}`;

            let response = await musicClient.spotifyApiGet(api);

            // check if the token needs to be refreshed
            if (response.statusText === "EXPIRED") {
                // refresh the token
                await musicClient.refreshSpotifyToken();
                // try again
                response = await musicClient.spotifyApiGet(api);
            }

            if (response && response.status === 200 && response.data) {
                const artistData = response.data;
                // delete external_urls
                delete artistData.external_urls;
                artist = artistData;
            }
        }

        if (artist) {
            // cache it (6 hours)
            cacheUtil.setItem(`artist_${id}`, artist, 60 * 60 * 6);
        } else {
            artist = new Artist();
        }

        return artist;
    }

    async getSpotifyWebCurrentTrack(): Promise<Track> {
        let track: Track;

        let api = "/v1/me/player/currently-playing";
        let response = await musicClient.spotifyApiGet(api);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }

        if (
            response &&
            response.status === 200 &&
            response.data &&
            response.data.item
        ) {
            track = this.copySpotifyTrackToCodyTrack(response.data.item);
        } else {
            track = new Track();
        }

        // initialize it with not assigned
        if (track) {
            track["state"] = TrackStatus.NotAssigned;
        }
        if (track && track.uri) {
            if (track.uri.includes("spotify:ad:")) {
                track.state = TrackStatus.Advertisement;
            } else {
                let context: PlayerContext = await this.getSpotifyPlayerContext();
                // is_playing
                if (context && context.is_playing) {
                    track["state"] = TrackStatus.Playing;
                } else {
                    track["state"] = TrackStatus.Paused;
                }
            }
        }

        return track;
    }

    async getSpotifyRecentlyPlayedTracks(limit: number): Promise<Track[]> {
        let api = "/v1/me/player/recently-played";
        if (limit) {
            api += `?limit=${limit}`;
        }
        let response = await musicClient.spotifyApiGet(api);
        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }

        let tracks: Track[] = [];
        if (
            response &&
            response.status === 200 &&
            response.data &&
            response.data.items
        ) {
            for (let i = 0; i < response.data.items.length; i++) {
                let spotifyTrack = response.data.items[i].track;
                const track: Track = this.copySpotifyTrackToCodyTrack(
                    spotifyTrack
                );
                tracks.push(track);
            }
        }

        return tracks;
    }

    async getRecommendationsForTracks(
        trackIds: string[],
        limit: number = 40,
        market: string = "",
        min_popularity: number = 20
    ) {
        let tracks: Track[] = [];

        // change the trackIds to non-uri ids
        trackIds = musicUtil.createTrackIdsFromUris(trackIds);
        const qsOptions = {
            market,
            seed_tracks: trackIds.join(","),
            limit,
            min_popularity
        };
        const api = `/v1/recommendations`;

        let response = await musicClient.spotifyApiGet(api, qsOptions);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api, qsOptions);
        }

        if (musicUtil.isResponseOk(response)) {
            tracks = response.data.tracks;
        }

        return tracks;
    }

    async getSpotifyPlayerContext(): Promise<PlayerContext> {
        let playerContext: PlayerContext = new PlayerContext();
        let api = "/v1/me/player";
        let response = await musicClient.spotifyApiGet(api);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }

        if (
            response &&
            response.status === 200 &&
            response.data &&
            response.data.item
        ) {
            // override "type" with "spotify"
            response.data.item["type"] = "spotify";
            response.data.item["playerType"] = PlayerType.WebSpotify;
            musicUtil.extractAristFromSpotifyTrack(response.data.item);
            playerContext = response.data;
        }
        return playerContext;
    }

    async launchAndPlaySpotifyTrack(
        trackId: string,
        spotifyUserId: string,
        playlistId: string = ""
    ) {
        // check if there's any spotify devices
        const spotifyDevices: PlayerDevice[] = await this.getSpotifyDevices(
            true
        );
        if (!spotifyDevices || spotifyDevices.length === 0) {
            // no spotify devices found, lets launch the web player with the track

            // launch it
            await this.launchWebPlayer(PlayerName.SpotifyWeb);

            // now select it from within the playlist within 1.2 seconds
            setTimeout(() => {
                this.playSpotifyTrackFromPlaylist(
                    trackId,
                    spotifyUserId,
                    playlistId,
                    5 /* checkTrackStateAndTryAgain */
                );
            }, 1200);
        } else {
            // a device is found, play using the device
            await this.playSpotifyTrackFromPlaylist(
                trackId,
                spotifyUserId,
                playlistId,
                2 /* checkTrackStateAndTryAgain */
            );
        }
    }

    async playSpotifyTrackFromPlaylist(
        trackId: string,
        spotifyUserId: string,
        playlistId: string = "",
        checkTrackStateAndTryAgainCount: number = 0
    ) {
        const spotifyUserUri = musicUtil.createSpotifyUserUriFromId(
            spotifyUserId
        );
        if (playlistId === SPOTIFY_LIKED_SONGS_PLAYLIST_NAME) {
            playlistId = "";
        }
        const spotifyDevices: PlayerDevice[] = await this.getSpotifyDevices(
            false
        );
        const deviceId = spotifyDevices.length > 0 ? spotifyDevices[0].id : "";
        let options: any = {};
        if (deviceId) {
            options["device_id"] = deviceId;
        }

        if (trackId) {
            options["track_ids"] = [trackId];
        } else {
            options["offset"] = { position: 0 };
        }
        if (playlistId) {
            const playlistUri = `${spotifyUserUri}:playlist:${playlistId}`;
            options["context_uri"] = playlistUri;
        }

        /**
         * to play a track without the play list id
         * curl -X "PUT" "https://api.spotify.com/v1/me/player/play?device_id=4f38ae14f61b3a2e4ed97d537a5cb3d09cf34ea1"
         * --data "{\"uris\":[\"spotify:track:2j5hsQvApottzvTn4pFJWF\"]}"
         */

        if (!playlistId) {
            // just play by track id
            await musicController.spotifyWebPlayTrack(trackId, deviceId);
        } else {
            // we have playlist id within the options, use that
            await musicController.spotifyWebPlayPlaylist(
                playlistId,
                trackId,
                deviceId
            );
        }

        if (checkTrackStateAndTryAgainCount > 0) {
            const track: Track = await this.getSpotifyWebCurrentTrack();

            if (musicUtil.isTrackPlaying(track)) {
                return;
            }

            checkTrackStateAndTryAgainCount--;

            // try again, 1.3 seconds
            setTimeout(() => {
                this.playSpotifyTrackFromPlaylist(
                    trackId,
                    spotifyUserId,
                    playlistId,
                    checkTrackStateAndTryAgainCount
                );
            }, 1300);
        }
    }

    launchWebPlayer(options: any) {
        if (options.album_id) {
            const albumId = musicUtil.createSpotifyIdFromUri(options.album_id);
            return musicUtil.launchWebUrl(
                `https://open.spotify.com/album/${albumId}`
            );
        } else if (options.track_id) {
            const trackId = musicUtil.createSpotifyIdFromUri(options.track_id);
            return musicUtil.launchWebUrl(
                `https://open.spotify.com/track/${trackId}`
            );
        } else if (options.playlist_id) {
            const playlistId = musicUtil.createSpotifyIdFromUri(
                options.playlist_id
            );
            return musicUtil.launchWebUrl(
                `https://open.spotify.com/playlist/${playlistId}`
            );
        }
        return musicUtil.launchWebUrl("https://open.spotify.com/browse");
    }

    copySpotifyTrackToCodyTrack(spotifyTrack: any): Track {
        let track: Track;
        if (spotifyTrack) {
            // delete some attributes that are currently not needed
            if (spotifyTrack.album) {
                delete spotifyTrack.album.available_markets;
                delete spotifyTrack.album.external_urls;
            }
            if (spotifyTrack.available_markets) {
                delete spotifyTrack.available_markets;
            }

            if (spotifyTrack.external_urls) {
                delete spotifyTrack.external_urls;
            }

            if (spotifyTrack.external_ids) {
                delete spotifyTrack.external_ids;
            }

            // pull out the artist info into a more readable set of attributes
            musicUtil.extractAristFromSpotifyTrack(spotifyTrack);

            track = spotifyTrack;

            if (spotifyTrack.duration_ms) {
                track.duration = spotifyTrack.duration_ms;
            }
        } else {
            track = new Track();
        }

        track.type = "spotify";
        track.playerType = PlayerType.WebSpotify;

        return track;
    }

    updateSpotifyLoved(loved: boolean) {
        //
    }
}
