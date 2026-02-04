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
    { name: '50x50', gaSuffix: 'size_m', gaCrop: 'crop_48x48' },
    { name: '150x150', gaSuffix: 'size_l', gaCrop: 'crop_175x175' },
    { name: '500x500', gaSuffix: 'size_l', gaCrop: 'crop_480x480' },
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

export const mapGaanaSong = (data: any): Song => {
  const artistsInfo = extractGaanaEntityInfo(data.entity_info, 'artist') || [];
  const albumInfo = extractGaanaEntityInfo(data.entity_info, 'album')?.[0] || {};

  return {
    id: data.seokey || data.entity_id,
    title: data.name,
    subtitle: artistsInfo.map((a: any) => a.name).join(', '),
    type: 'song',
    image: createGaanaImageLinks(data.artwork || data.atw),
    language: data.language,
    year: extractGaanaEntityInfo(data.entity_info, 'release_date'),
    duration: extractGaanaEntityInfo(data.entity_info, 'duration'),
    playCount: extractGaanaEntityInfo(data.entity_info, 'play_ct'),
    mediaUrls: [], // To be populated later
    artists: artistsInfo.map((artist: any) => ({
      id: artist.seokey || artist.artist_id,
      name: artist.name,
      type: 'artist',
    })),
    album: {
      id: albumInfo.album_seokey || albumInfo.album_id,
      name: albumInfo.name,
      url: albumInfo.album_seokey,
    },
    source: 'gaana',
  };
};

export const mapGaanaAlbum = (data: any): Album => {
  const artistsInfo = extractGaanaEntityInfo(data.entity_info, 'artist') || [];

  return {
    id: data.seokey || data.entity_id,
    title: data.name,
    subtitle: artistsInfo.map((a: any) => a.name).join(', '),
    type: 'album',
    image: createGaanaImageLinks(data.artwork || data.atw),
    language: data.language,
    year: extractGaanaEntityInfo(data.entity_info, 'release_date'),
    songCount: extractGaanaEntityInfo(data.entity_info, 'track_ids')?.length?.toString(),
    artists: artistsInfo.map((artist: any) => ({
      id: artist.seokey || artist.artist_id,
      name: artist.name,
      type: 'artist',
    })),
    songs: [], // To be populated by details call
    source: 'gaana',
    url: data.seokey,
  };
};

export const mapGaanaPlaylist = (data: any): Playlist => {
  return {
    id: data.seokey || data.entity_id,
    title: data.name,
    subtitle: data.language,
    type: 'playlist',
    image: createGaanaImageLinks(data.artwork || data.atw),
    songCount: extractGaanaEntityInfo(data.entity_info, 'track_ids')?.length?.toString(),
    source: 'gaana',
    url: data.seokey,
  };
};

export const mapGaanaArtist = (data: any): Artist => {
  return {
    id: data.seokey || data.entity_id,
    name: data.name,
    type: 'artist',
    image: createGaanaImageLinks(data.artwork || data.atw),
    url: data.seokey,
  };
};

export const mapGaanaTrack = (data: any): Song => {
  return {
    id: data.seokey || data.track_id,
    title: data.track_title || data.name,
    subtitle: (data.artist || []).map((a: any) => a.name).join(', '),
    type: 'song',
    image: createGaanaImageLinks(
      data.artwork_large || data.artwork_web || data.artwork || data.atw,
    ),
    language: data.language,
    year: data.release_date,
    duration: data.duration,
    playCount: data.total_favourite_count?.toString(),
    mediaUrls: [],
    artists: (data.artist || []).map((artist: any) => ({
      id: artist.seokey || artist.artist_id,
      name: artist.name,
      type: 'artist',
    })),
    album: {
      id: data.albumseokey || data.album_id,
      name: data.album_title,
      url: data.albumseokey,
    },
    source: 'gaana',
  };
};

export const mapGaanaEntity = (data: any): any => {
  switch (data.entity_type) {
    case 'TR':
      return mapGaanaSong(data);
    case 'AL':
      return mapGaanaAlbum(data);
    case 'PL':
      return mapGaanaPlaylist(data);
    case 'AR':
      return mapGaanaArtist(data);
    default:
      return data;
  }
};
