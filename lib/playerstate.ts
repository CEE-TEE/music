import { MusicUtil } from "./util";
import { MusicController } from "./controller";
import { MusicStore } from "./store";
import { MusicClient } from "./client";
import {
    PlayerDevice,
    Track,
    PlayerType,
    PlayerContext,
    TrackStatus,
    Artist,
    PlayerName,
    CodyResponse
} from "./models";
import { CacheManager } from "./cache";
import { AudioStat } from "./audiostat";

const musicStore = MusicStore.getInstance();
const musicClient = MusicClient.getInstance();
const audioStat = AudioStat.getInstance();
const musicController = MusicController.getInstance();
const musicUtil = new MusicUtil();
const cacheMgr = CacheManager.getInstance();

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
        clearCache: boolean = false
    ): Promise<PlayerDevice[]> {
        if (clearCache) {
            cacheMgr.set("spotify-devices", null);
        }
        const accessToken = musicStore.spotifyAccessToken;
        if (!accessToken) {
            return [];
        }
        let devices = cacheMgr.get("spotify-devices");
        if (devices && devices.length) {
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
        devices = [];
        if (response.data && response.data.devices) {
            devices = response.data.devices;
        }

        if (devices && devices.length) {
            cacheMgr.set("spotify-devices", devices);
        }

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

    async getSpotifyTracks(
        ids: string[],
        includeArtistData: boolean = false,
        includeAudioFeaturesData: boolean = false,
        includeGenre: boolean = false
    ): Promise<Track[]> {
        const finalIds: string[] = [];
        ids.forEach(id => {
            finalIds.push(musicUtil.createSpotifyIdFromUri(id));
        });
        const tracksToReturn: Track[] = [];
        const api = `/v1/tracks`;
        const qsOptions = { ids: finalIds.join(",") };

        let response = await musicClient.spotifyApiGet(api, qsOptions);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }

        if (response && response.status === 200 && response.data) {
            let artistIdMap: any = {};
            const tracks: any[] = response.data.tracks || [];
            for (let x = 0; x < tracks.length; x++) {
                const trackData = tracks[x];
                const track: Track = musicUtil.copySpotifyTrackToCodyTrack(
                    trackData
                );
                track.progress_ms = response.data.progress_ms
                    ? response.data.progress_ms
                    : 0;

                if (includeArtistData) {
                    for (let i = 0; i < track.artists.length; i++) {
                        const artist: any = track.artists[i];
                        artistIdMap[artist.id] = artist.id;
                    }
                }

                tracksToReturn.push(track);
            }

            if (includeArtistData) {
                let artistIds = Object.keys(artistIdMap).map(key => {
                    return key;
                });

                // fetch the artists all at once or in batches
                let artists: any[] = [];
                if (artistIds) {
                    // spotify's limit is 50, so batch if it's greater than 50
                    if (artistIds.length > 50) {
                        const maxArtists = 50;
                        let offset = 0;
                        let maxlen = artistIds.length / maxArtists;
                        if (maxlen % 1 !== 0) {
                            maxlen += 1;
                        }
                        for (let idx = 0; idx < maxlen; idx++) {
                            artistIds = artistIds.splice(offset, 50);
                            const batchedArtists = await this.getSpotifyArtistsByIds(
                                artistIds
                            );
                            if (batchedArtists) {
                                artists.push(...batchedArtists);
                            }
                            offset += maxArtists;
                        }
                    } else {
                        artists = await this.getSpotifyArtistsByIds(artistIds);
                    }
                }

                if (artists && artists.length > 0) {
                    // go through the tracks and update the artist with the fully populated one
                    for (let z = 0; z < tracksToReturn.length; z++) {
                        const t: Track = tracksToReturn[z];
                        const trackArtistIds: string[] = t.artists.map(
                            (artist: any) => {
                                return artist.id;
                            }
                        );
                        const artistsForTrack: any[] = artists.filter(
                            (n: any) => trackArtistIds.includes(n.id)
                        );
                        if (artistsForTrack && artistsForTrack.length) {
                            // replace the artists
                            t.artists = artistsForTrack;
                        }

                        if (!t.genre && includeGenre) {
                            // first check if we have an artist in artists
                            let genre = "";
                            if (
                                t.artists &&
                                t.artists.length > 0 &&
                                t.artists[0].genres
                            ) {
                                // make sure we use the highest frequency genre
                                try {
                                    genre = musicClient.getHighestFrequencySpotifyGenre(
                                        t.artists[0].genres
                                    );
                                } catch (e) {
                                    //
                                }
                            }
                            if (!genre) {
                                // get the genre
                                try {
                                    genre = await musicController.getGenre(
                                        t.artist,
                                        t.name
                                    );
                                } catch (e) {
                                    //
                                }
                            }
                            if (genre) {
                                t.genre = genre;
                            }
                        }
                    }
                }
            }

            // get the features
            if (includeAudioFeaturesData) {
                const spotifyAudioFeatures = await audioStat
                    .getSpotifyAudioFeatures(ids)
                    .catch(e => {
                        return null;
                    });
                if (spotifyAudioFeatures && spotifyAudioFeatures.length > 0) {
                    // "id": "4JpKVNYnVcJ8tuMKjAj50A",
                    // "uri": "spotify:track:4JpKVNYnVcJ8tuMKjAj50A",
                    // track.features = spotifyAudioFeatures[0];
                    for (let i = 0; i < spotifyAudioFeatures.length; i++) {
                        const uri: string = spotifyAudioFeatures[i].uri;
                        const foundTrack = tracksToReturn.find(
                            (t: Track) => t.uri === uri
                        );
                        if (foundTrack) {
                            foundTrack.features = spotifyAudioFeatures[i];
                        }
                    }
                }
            }
        }

        return tracksToReturn;
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
            track = musicUtil.copySpotifyTrackToCodyTrack(response.data);
            track.progress_ms = response.data.progress_ms
                ? response.data.progress_ms
                : 0;

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
                    // make sure we use the highest frequency genre
                    genre = musicClient.getHighestFrequencySpotifyGenre(
                        track.artists[0].genres
                    );
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

    async getSpotifyArtistsByIds(ids: string[]): Promise<Artist[]> {
        let artists: Artist[] = [];

        ids = musicUtil.createSpotifyIdsFromUris(ids);

        // check the cache first

        let api = `/v1/artists`;
        const qParam = { ids };

        let response = await musicClient.spotifyApiGet(api, qParam);

        // check if the token needs to be refreshed
        if (response.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            response = await musicClient.spotifyApiGet(api);
        }

        if (response && response.status === 200 && response.data) {
            artists = response.data.artists || [];
        }

        return artists;
    }

    async getSpotifyArtistById(id: string): Promise<Artist> {
        let artist: Artist = new Artist();

        id = musicUtil.createSpotifyIdFromUri(id);

        // check the cache first

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
            const data = response.data;
            track = musicUtil.copySpotifyTrackToCodyTrack(response.data.item);
            track.progress_ms = response.data.progress_ms
                ? response.data.progress_ms
                : 0;
            // set whether this track is playing or not
            /**
             * data: {
                context:null
                currently_playing_type:"track"
                is_playing:true
                item:Object {album: Object, artists: Array(1), available_markets: Array(79), …}
                progress_ms:153583
                timestamp:1583797755729
            }
            */
            const isPlaying =
                data.is_playing !== undefined && data.is_playing !== null
                    ? data.is_playing
                    : false;
            if (track.uri && track.uri.includes("spotify:ad:")) {
                track.state = TrackStatus.Advertisement;
            } else {
                track.state = isPlaying
                    ? TrackStatus.Playing
                    : TrackStatus.Paused;
            }
        } else {
            track = new Track();
            track.state = TrackStatus.NotAssigned;
            track.httpStatus = response.status;
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
                const track: Track = musicUtil.copySpotifyTrackToCodyTrack(
                    spotifyTrack
                );
                tracks.push(track);
            }
        }

        return tracks;
    }

    async getRecommendationsForTracks(
        seed_tracks: string[] = [],
        limit: number = 40,
        market: string = "",
        min_popularity: number = 20,
        target_popularity: number = 90,
        seed_genres: string[] = [],
        seed_artists: string[] = [],
        features: any = {}
    ) {
        let tracks: Track[] = [];

        // change the trackIds to non-uri ids
        seed_tracks = musicUtil.createTrackIdsFromUris(seed_tracks);
        // the create trackIds will create normal artist ids as well
        seed_artists = musicUtil.createTrackIdsFromUris(seed_artists);
        // it can only take up to 5, remove the rest
        if (seed_tracks.length > 5) {
            seed_tracks.length = 5;
        }
        if (seed_genres.length > 5) {
            seed_genres.length = 5;
        }
        if (seed_artists.length > 5) {
            seed_artists.length = 5;
        }
        const qsOptions: any = {
            limit,
            min_popularity,
            target_popularity
        };
        if (seed_genres.length) {
            qsOptions["seed_genres"] = seed_genres.join(",");
        }
        if (seed_tracks.length) {
            qsOptions["seed_tracks"] = seed_tracks.join(",");
        }
        if (seed_artists.length) {
            qsOptions["seed_artists"] = seed_artists.join(",");
        }
        if (market) {
            qsOptions["market"] = market;
        }
        const featureKeys = Object.keys(features);
        if (featureKeys.length) {
            featureKeys.forEach(key => {
                qsOptions[key] = features[key];
            });
        }
        const api = `/v1/recommendations`;

        // add to the api to prevent the querystring from escaping the comma

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

    async updateRepeatMode(setToOn: boolean): Promise<CodyResponse> {
        const state = setToOn ? "track" : "off";

        const api = `/v1/me/player/repeat`;
        let codyResp = await musicClient.spotifyApiPut(api, { state }, {});

        // check if the token needs to be refreshed
        if (codyResp.statusText === "EXPIRED") {
            // refresh the token
            await musicClient.refreshSpotifyToken();
            // try again
            codyResp = await musicClient.spotifyApiPut(api, { state }, {});
        }

        return codyResp;
    }

    async getSpotifyPlayerContext(clearCache: boolean): Promise<PlayerContext> {
        if (clearCache) {
            cacheMgr.set("player-context", null);
        }
        let playerContext: PlayerContext = cacheMgr.get("player-context");
        if (playerContext) {
            return playerContext;
        }

        playerContext = new PlayerContext();
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
            if (playerContext && playerContext.device) {
                // 15 second cache
                cacheMgr.set("player-context", playerContext, 15);
            }
        }
        return playerContext;
    }

    async launchAndPlaySpotifyTrack(
        trackId: string = "",
        playlistId: string = "",
        playerName: PlayerName = PlayerName.SpotifyWeb
    ) {
        // check if there's any spotify devices
        const spotifyDevices: PlayerDevice[] = await this.getSpotifyDevices();

        if (!spotifyDevices || spotifyDevices.length === 0) {
            // no spotify devices found, lets launch the web player with the track

            // launch it
            await this.launchWebPlayer(playerName);

            // now select it from within the playlist within 2 seconds
            await setTimeout(() => {
                this.playSpotifyTrackFromPlaylist(
                    trackId,
                    musicStore.spotifyUserId,
                    playlistId
                );
            }, 5000);
        } else {
            // a device is found, play using the device
            await this.playSpotifyTrackFromPlaylist(
                trackId,
                musicStore.spotifyUserId,
                playlistId
            );
        }
    }

    async playSpotifyTrackFromPlaylist(
        trackId: string,
        spotifyUserId: string,
        playlistId: string = ""
    ) {
        const spotifyUserUri = musicUtil.createSpotifyUserUriFromId(
            spotifyUserId
        );
        if (playlistId === SPOTIFY_LIKED_SONGS_PLAYLIST_NAME) {
            playlistId = "";
        }
        const spotifyDevices: PlayerDevice[] = await this.getSpotifyDevices();
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

    updateSpotifyLoved(loved: boolean) {
        //
    }
}
