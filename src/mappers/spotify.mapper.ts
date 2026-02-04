import { Playlist, Song } from '../types';

export const mapSpotifyTrackToSong = (track: any): Song => {
  return {
    id: track.id,
    title: track.name,
    subtitle: track.artists.join(', '),
    type: 'song',
    image: [], // Spotify scraping currently doesn't provide track images in the simple row
    language: '',
    year: '',
    duration: track.duration,
    playCount: '',
    mediaUrls: [],
    artists: track.artists.map((name: string) => ({
      id: '',
      name: name,
      type: 'artist',
    })),
    album: {
      id: '',
      name: track.album,
    },
    source: 'spotify',
  };
};

export const mapSpotifyPlaylist = (data: any): Playlist => {
  return {
    id: data.playlistId,
    title: data.playlistName,
    subtitle: '',
    type: 'playlist',
    image: [], // Spotify scraping currently doesn't provide playlist image
    songCount: data.trackCount.toString(),
    followers: '',
    description: data.description,
    songs: (data.tracks || []).map(mapSpotifyTrackToSong),
    source: 'spotify',
    url: `https://open.spotify.com/playlist/${data.playlistId}`,
  };
};
