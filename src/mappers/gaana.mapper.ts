import { decryptGaanaUrl } from '../gaana/crypto';
import { Album, Artist, Channel, Images, Occasion, Playlist, Song } from '../types';

/**
 * Extracts a value from Gaana's entity_info array.
 * Gaana stores extra metadata in an array of {key, value} objects.
 */
export const extractGaanaEntityInfo = (entityInfo: any[], key: string): any => {
  if (!entityInfo || !Array.isArray(entityInfo)) return null;
  const item = entityInfo.find((info) => info.key === key);
  return item ? item.value : null;
};

/**
 * Extracts a reliable image URL from Gaana's various image fields.
 * Handles atwj JSON strings and prioritizes size_m or size_l if available.
 */
export const getGaanaImageUrl = (imageSource: any): string => {
  if (!imageSource) return '';
  if (typeof imageSource === 'string') {
    // If it's a JSON string (common for atwj)
    if (imageSource.startsWith('{')) {
      try {
        const parsed = JSON.parse(imageSource);
        return parsed.size_l || parsed.size_m || parsed.size_s || Object.values(parsed)[0];
      } catch (e) {
        return imageSource;
      }
    }
    return imageSource;
  }
  if (typeof imageSource === 'object') {
    return (
      imageSource.size_l ||
      imageSource.size_m ||
      imageSource.size_s ||
      Object.values(imageSource)[0]
    );
  }
  return '';
};

/**
 * Modern imagery harvester for Gaana.
 * Instead of picking one field, it looks at all available fields (atw, artwork, artwork_medium, etc.)
 * to find the best native match for each quality bucket.
 */
export const getGaanaImagery = (data: any): Images => {
  if (!data) return [];
  if (typeof data === 'string') {
    // Basic fallback if only a URL string is provided
    return [
      { quality: '50x50', link: data.replace(/size_[a-z]+|crop_\d+x\d+/, 'size_s') },
      { quality: '150x150', link: data.replace(/size_[a-z]+|crop_\d+x\d+/, 'size_m') },
      { quality: '500x500', link: data.replace(/size_[a-z]+|crop_\d+x\d+/, 'size_l') },
    ];
  }

  const fields = [
    'atw',
    'atwj',
    'artwork_large',
    'artwork_medium',
    'artwork_web',
    'artwork_bio',
    'artwork_175x175',
    'artwork',
  ];

  const urls = fields
    .map((f) => getGaanaImageUrl(data[f]))
    .filter((u) => u && typeof u === 'string' && u.length > 0);

  if (urls.length === 0) return [];

  const targets = [
    {
      names: ['50x50', 'small'],
      matches: ['size_s', 'crop_80x80'],
      suffix: 'size_s',
      crop: 'crop_80x80',
    },
    {
      names: ['150x150', 'medium'],
      matches: ['size_m', 'crop_175x175'],
      suffix: 'size_m',
      crop: 'crop_175x175',
    },
    {
      names: ['500x500', 'xl', 'large'],
      matches: ['size_l', 'size_xl', 'crop_480x480'],
      suffix: 'size_l',
      crop: 'crop_480x480',
    },
  ];

  const finalImages: { quality: string; link: string }[] = [];
  const suffixUrls = urls.filter((u) => u.includes('size_'));
  const cropUrls = urls.filter((u) => u.includes('crop_'));

  targets.forEach((t) => {
    // 1. Native Match First (look for a link that already satisfies the quality)
    let base = urls.find((u) => t.matches.some((m) => u.includes(m)));

    // 2. Transformed Second (take the best available link and transform it)
    if (!base) base = suffixUrls[0] || cropUrls[0] || urls[0];

    let finalLink = base;
    if (base && base.includes('size_')) {
      finalLink = base.replace(/size_[a-z]+/, t.suffix);
    } else if (base && base.includes('crop_')) {
      const cropRegex = /crop_\d+x\d+/;
      finalLink = base.replace(cropRegex, t.crop);
    }

    t.names.forEach((name) => {
      let finalStr = finalLink || '';
      // FINAL SAFEGUARD: Force size_l if size_xl is detected to avoid redirect loops
      if (finalStr.includes('size_xl')) {
        finalStr = finalStr.replace('size_xl', 'size_l');
      }
      finalImages.push({ quality: name, link: finalStr });
    });
  });

  return finalImages;
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
      image: getGaanaImagery(artist),
      type: 'artist',
    }),
  );

  return {
    id: data.seokey || data.track_id || data.entity_id,
    title: data.name || data.track_title,
    subtitle: mappedArtists.map((a: any) => a.name).join(', '),
    type: 'song',
    image: getGaanaImagery(data),
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
      image: getGaanaImagery(artist),
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
    image: getGaanaImagery(data),
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
    image: getGaanaImagery(data),
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
    image: getGaanaImagery(data),
    followers: data.favorite_count?.toString(),
    bio: data.desc || data.detailed_description,
    songCount: data.songs?.toString(),
    albumCount: data.albums?.toString(),
    url: data.seokey,
  };
};

export const mapGaanaRadio = (data: any): Channel => {
  return {
    id: data.entity_id || data.seokey,
    title: data.name,
    subtitle: data.language,
    type: 'channel',
    image: getGaanaImagery(data),
    source: 'gaana',
    url: data.seokey,
  };
};

export const mapGaanaOccasion = (data: any): Occasion => {
  return {
    id: data.seokey || data.entity_id,
    title: data.name,
    type: 'occasion',
    image: getGaanaImagery(data),
    source: 'gaana',
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
    image: getGaanaImagery(data),
    language: language,
    year: year?.toString(),
    songCount: data.trackcount?.toString(),
    artists: artists.map((artist: any) => ({
      ...artist,
      image: getGaanaImagery(artist),
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
    case 'RL':
    case 'RADIO':
      return mapGaanaRadio(data);
    case 'OC':
    case 'OCCASION':
      return mapGaanaOccasion(data);
    default:
      return data;
  }
};
