import { decryptGaanaUrl } from '../gaana/helper';
import { Album, Artist, Images, Playlist, Song } from '../types';

/**
 * Extracts a value from Gaana's entity_info array.
 * Gaana stores extra metadata in an array of {key, value} objects.
 */
export const extractGaanaEntityInfo = (entityInfo: any[], key: string): any => {
  if (!entityInfo || !Array.isArray(entityInfo)) return null;
  const item = entityInfo.find((info) => info.key === key);
  return item ? item.value : null;
};

export const createGaanaImageLinks = (link: string): Images => {
  if (!link || typeof link !== 'string') return [];

  const qualities = [
    { name: '50x50', gaSuffix: 'size_s', gaCrop: 'crop_80x80' },
    { name: '150x150', gaSuffix: 'size_m', gaCrop: 'crop_175x175' },
    { name: '500x500', gaSuffix: 'size_xl', gaCrop: 'crop_480x480' },
  ];

  // Try to determine the pattern
  let pattern: 'suffix' | 'crop' | 'none' = 'none';
  if (link.includes('size_m') || link.includes('size_s') || link.includes('size_l'))
    pattern = 'suffix';
  else if (link.includes('crop_')) pattern = 'crop';

  return qualities.map((q) => {
    let newLink = link;
    if (pattern === 'suffix') {
      newLink = link.replace(/size_[msl]/, q.gaSuffix);
    } else if (pattern === 'crop') {
      // Find the crop pattern like crop_175x175
      const cropRegex = /crop_\d+x\d+/;
      newLink = link.replace(cropRegex, q.gaCrop);
    }
    return {
      quality: q.name,
      link: newLink,
    };
  });
};

const extractMediaUrls = (data: any) => {
  const streamUrl = extractGaanaEntityInfo(data.entity_info, 'stream_url') || data.urls;
  if (!streamUrl) return [];

  return Object.entries(streamUrl)
    .map(([key, val]: any) => ({
      quality: key,
      link: decryptGaanaUrl(val.message),
    }))
    .filter((u) => u.link);
};

export const mapGaanaSong = (data: any): Song => {
  const artistsInfo =
    extractGaanaEntityInfo(data.entity_info, 'artist') || data.artist || data.primaryartist || [];
  const albumInfo =
    extractGaanaEntityInfo(data.entity_info, 'album')?.[0] ||
    (data.album_id
      ? { name: data.album_title, album_id: data.album_id, album_seokey: data.albumseokey }
      : {});
  const year =
    extractGaanaEntityInfo(data.entity_info, 'release_date') || data.release_date || data.year;

  const mappedArtists = (Array.isArray(artistsInfo) ? artistsInfo : [artistsInfo]).map(
    (artist: any) => ({
      id: artist.seokey || artist.artist_id,
      name: artist.name,
      role: artist.role,
      image: createGaanaImageLinks(artist.atw || artist.artwork),
      type: 'artist',
    }),
  );

  return {
    id: data.seokey || data.track_id || data.entity_id,
    title: data.name || data.track_title,
    subtitle: mappedArtists.map((a: any) => a.name).join(', '),
    type: 'song',
    image: createGaanaImageLinks(
      data.artwork_large || data.artwork_web || data.artwork || data.atw,
    ),
    language: data.language,
    year: year?.toString()?.split('-')?.[0],
    duration: extractGaanaEntityInfo(data.entity_info, 'duration') || data.duration,
    playCount:
      extractGaanaEntityInfo(data.entity_info, 'play_ct') || data.total_favourite_count?.toString(),
    mediaUrls: extractMediaUrls(data),
    artists: mappedArtists,
    album: {
      id: albumInfo.album_seokey || albumInfo.album_id,
      name: albumInfo.name || albumInfo.album_title,
      url: albumInfo.album_seokey,
    },
    hasLyrics: !!(data.lyrics_url || extractGaanaEntityInfo(data.entity_info, 'lyrics_url')),
    copyright: data.recordlevel || data.vendor_name,
    releaseDate: year,
    source: 'gaana',
  };
};

export const mapGaanaTrack = mapGaanaSong;

export const mapGaanaAlbum = (data: any): Album => {
  const artistsInfo =
    extractGaanaEntityInfo(data.entity_info, 'artist') || data.artist || data.primaryartist || [];
  const year = extractGaanaEntityInfo(data.entity_info, 'release_date') || data.year;
  const language = data.language;

  const mappedArtists = (Array.isArray(artistsInfo) ? artistsInfo : [artistsInfo]).map(
    (artist: any) => ({
      id: artist.seokey || artist.artist_id,
      name: artist.name,
      image: createGaanaImageLinks(artist.atw || artist.artwork),
      type: 'artist',
    }),
  );

  return {
    id: data.seokey || data.entity_id || data.album_id,
    title: data.name || data.title,
    subtitle: mappedArtists.map((a: any) => a.name).join(', '),
    headerDesc: `Album • ${language} • ${year}`,
    description: data.detailed_description,
    type: 'album',
    image: createGaanaImageLinks(data.artwork || data.atw),
    language: language,
    year: year?.toString(),
    songCount:
      extractGaanaEntityInfo(data.entity_info, 'track_ids')?.length?.toString() ||
      data.trackcount?.toString(),
    artists: mappedArtists,
    songs: [], // To be populated by details call
    copyright: data.recordlevel || data.vendor_name,
    releaseDate: data.release_date,
    playCount: data.al_play_ct,
    source: 'gaana',
    url: data.seokey,
  };
};

export const mapGaanaPlaylist = (data: any): Playlist => {
  return {
    id: data.seokey || data.entity_id || data.playlist_id,
    title: data.name || data.title,
    subtitle: data.language,
    type: 'playlist',
    image: createGaanaImageLinks(data.artwork || data.atw),
    songCount:
      extractGaanaEntityInfo(data.entity_info, 'track_ids')?.length?.toString() ||
      data.trackcount?.toString() ||
      data.count?.toString(),
    followers: data.favorite_count?.toString(),
    description: data.detailed_description,
    songs: [],
    source: 'gaana',
    url: data.seokey,
  };
};

export const mapGaanaArtist = (data: any): Artist => {
  return {
    id: data.seokey || data.entity_id || data.artist_id,
    name: data.name,
    type: 'artist',
    image: createGaanaImageLinks(
      data.artwork_bio || data.atw || data.artwork_175x175 || data.artwork,
    ),
    followers: data.favorite_count?.toString(),
    bio: data.desc || data.detailed_description,
    songCount: data.songs?.toString(),
    albumCount: data.albums?.toString(),
    url: data.seokey,
  };
};

export const mapGaanaSearchAlbum = (data: any): Album => {
  const artists = (data.artist || data.primaryartist || []).map((artist: any) => ({
    id: artist.seokey || artist.artist_id,
    name: artist.name,
    type: 'artist',
  }));
  const year = data.year || data.release_date?.split('-')[0];
  const language = data.language;

  return {
    id: data.seokey || data.album_id || data.entity_id,
    title: data.title || data.name,
    subtitle: artists.map((a: any) => a.name).join(', '),
    headerDesc: `Album • ${language} • ${year}`,
    description: data.detailed_description,
    type: 'album',
    image: createGaanaImageLinks(data.artwork || data.atw),
    language: language,
    year: year?.toString(),
    songCount: data.trackcount?.toString(),
    artists: artists.map((artist: any) => ({
      ...artist,
      image: createGaanaImageLinks(artist.atw || artist.artwork),
    })),
    songs: [],
    copyright: data.recordlevel || data.vendor_name,
    releaseDate: data.release_date,
    playCount: data.al_play_ct,
    source: 'gaana',
    url: data.seokey,
  };
};

export const mapGaanaEntity = (data: any): any => {
  const type = (data.entity_type || '').toUpperCase();
  switch (type) {
    case 'TR':
    case 'TRACK':
      return mapGaanaSong(data);
    case 'AL':
    case 'ALBUM':
      return mapGaanaSearchAlbum(data);
    case 'PL':
    case 'PLAYLIST':
      return mapGaanaPlaylist(data);
    case 'AR':
    case 'ARTIST':
      return mapGaanaArtist(data);
    default:
      return data;
  }
};
