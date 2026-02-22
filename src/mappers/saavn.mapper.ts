import { createDownloadLinks, getToken, isValidTitle } from '../helpers/common';
import { saavnDataConfigs } from '../helpers/dataConfig';
import { dataExtractor } from '../helpers/dataExtractor';
import { isArray } from '../helpers/validators';
import { Album, Artist, Channel, Images, Playlist, Song } from '../types';

export const createImageLinks = (link: string): Images => {
  const qualities = ['50x50', '150x150', '500x500'];

  if (!link || typeof link !== 'string') return [];

  // If it's already a quality link with one of the standard sizes
  for (const q of qualities) {
    if (link.includes(q)) {
      return qualities.map((quality) => ({
        quality,
        link: link.replace(q, quality),
      }));
    }
  }

  // Fallback for links that don't follow the pattern or are already high res
  return [{ quality: '500x500', link: link }];
};

export const mapSaavnSong = (data: any): Song => {
  const song: any = {};
  for (const key in saavnDataConfigs.list) {
    const val = dataExtractor(data, saavnDataConfigs.list[key]);
    song[key] = val;
  }

  const token = getToken(song.token || song.url || '') || '';
  const id = token || song.id;

  return {
    id: id,
    songId: song.id,
    token,
    title: isValidTitle(song.title) ? song.title : song.song || song.name || 'Unknown Song',
    subtitle: song.subtitle,
    type: 'song',
    image: createImageLinks(dataExtractor(data, saavnDataConfigs.list.images)),
    language: song.language,
    year: song.year,
    duration: song.duration,
    playCount: song.playCount,
    mediaUrls: song.mediaUrls ? (createDownloadLinks(song.mediaUrls) as Images) : [],
    artists: (song.artists || []).map((artist: any) => ({
      id: getToken(artist.perma_url || '') || artist.id,
      name: artist.name,
      role: artist.role,
      image: createImageLinks(artist.image),
      type: artist.type,
      url: artist.perma_url,
    })),
    album: {
      id:
        (song.albumUrl?.includes('/album/') ? getToken(song.albumUrl) : null) || song.albumId || '',
      name: isValidTitle(song.album) ? song.album : '',
      url: song.albumUrl?.includes('/album/') ? song.albumUrl : '',
    },
    hasLyrics: song.hasLyrics === 'true',
    copyright: song.copyright,
    releaseDate: song.release_date,
    source: 'saavn',
  };
};

export const mapSaavnAlbum = (data: any): Album => {
  const album: any = {};
  for (const key in saavnDataConfigs.albumConfig) {
    album[key] = dataExtractor(data, saavnDataConfigs.albumConfig[key]);
  }

  const token = getToken(album.token || album.url || '');

  return {
    id: token || album.id,
    title: album.title,
    subtitle: album.subtitle,
    headerDesc: album.description,
    type: 'album',
    image: createImageLinks(dataExtractor(data, saavnDataConfigs.albumConfig.images)),
    language: album.language,
    year: album.year,
    songCount: album.songCount,
    artists: (album.artists || []).map((artist: any) => ({
      id: getToken(artist.perma_url || '') || artist.id,
      name: artist.name,
      image: createImageLinks(artist.image),
      type: artist.type,
      url: artist.perma_url,
    })),
    songs: isArray(album.list) ? album.list.map(mapSaavnSong) : [],
    source: 'saavn',
    url: album.token || album.url,
  };
};

export const mapSaavnArtist = (data: any): Artist => {
  const url = dataExtractor<string>(data, saavnDataConfigs.artistMeta.token);
  const id = dataExtractor<string>(data, saavnDataConfigs.artistMeta.id);

  return {
    id: getToken(url || '') || id,
    name: dataExtractor(data, saavnDataConfigs.artistMeta.title),
    subtitle: dataExtractor(data, saavnDataConfigs.artistMeta.subtitle),
    image: createImageLinks(dataExtractor(data, saavnDataConfigs.artistMeta.images)),
    followers: dataExtractor(data, saavnDataConfigs.artistMeta.followers),
    type: 'artist',
    url: url,
    bio: dataExtractor(data, saavnDataConfigs.artistMeta.bio),
  };
};

export const mapSaavnPlaylist = (data: any): Playlist => {
  const url = dataExtractor<string>(data, saavnDataConfigs.albumConfig.token);
  const id = dataExtractor<string>(data, saavnDataConfigs.albumConfig.id);

  return {
    id: getToken(url || '') || id,
    title: dataExtractor(data, saavnDataConfigs.albumConfig.title),
    subtitle: dataExtractor(data, saavnDataConfigs.albumConfig.subtitle),
    type: 'playlist',
    image: createImageLinks(dataExtractor(data, saavnDataConfigs.albumConfig.images)),
    songCount: dataExtractor(data, saavnDataConfigs.albumConfig.songCount),
    followers: dataExtractor(data, saavnDataConfigs.albumConfig.followerCount),
    description: dataExtractor(data, saavnDataConfigs.albumConfig.description),
    songs: isArray(data.list) ? data.list.map(mapSaavnSong) : [],
    source: 'saavn',
    url: url,
  };
};

export const mapSaavnChannel = (data: any): Channel => {
  const url = dataExtractor<string>(data, saavnDataConfigs.home.token);
  const id = dataExtractor<string>(data, saavnDataConfigs.home.id);
  const language = dataExtractor<string>(data, saavnDataConfigs.home.moreInfo.language);
  const stationType = dataExtractor<string>(data, saavnDataConfigs.home.moreInfo.stationType);

  return {
    id: id || getToken(url || ''),
    title: dataExtractor(data, saavnDataConfigs.home.title),
    subtitle: dataExtractor(data, saavnDataConfigs.home.subtitle) || language,
    type: stationType ? 'radio_station' : 'channel',
    image: createImageLinks(dataExtractor(data, saavnDataConfigs.home.images)),
    language,
    stationType,
    source: 'saavn',
    url: url,
  };
};
