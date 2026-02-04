import { capitalizeFirstLetter, toCamelCase, toSentenceCase } from '../helpers/common';
import { saavnDataConfigs } from '../helpers/dataConfig';
import { dataExtractor } from '../helpers/dataExtractor';
import { isArray, isEmptyArray } from '../helpers/validators';
import {
  createImageLinks,
  mapSaavnAlbum,
  mapSaavnArtist,
  mapSaavnChannel,
  mapSaavnPlaylist,
  mapSaavnSong,
} from '../mappers/saavn.mapper';
import { Album, Artist, HomeData, HomeSection, Playlist, Song } from '../types';

const excludedKeys = ['history', 'city_mod'];

export const dataSanitizer = (data: any): Song | Album | Playlist | Artist | any => {
  const type = dataExtractor<string>(data, saavnDataConfigs.home.type);

  if (type === 'song') {
    return mapSaavnSong(data);
  }
  if (type === 'album') {
    return mapSaavnAlbum(data);
  }
  if (type === 'playlist') {
    return mapSaavnPlaylist(data);
  }
  if (type === 'artist') {
    return mapSaavnArtist(data);
  }
  if (type === 'channel') {
    return mapSaavnChannel(data);
  }

  // Fallback for other types or generic mapping
  return {
    id: dataExtractor<string>(data, saavnDataConfigs.home.id) || '',
    title: dataExtractor<string>(data, saavnDataConfigs.home.title) || '',
    subtitle: dataExtractor<string>(data, saavnDataConfigs.home.subtitle),
    type: type || 'unknown',
    image: createImageLinks(dataExtractor<string>(data, saavnDataConfigs.home.images) || ''),
    source: 'saavn',
  };
};

export const songDataSanitizer = (data: any[]) => {
  return data.map(mapSaavnSong);
};

export const albumDataSanitizer = (data: any) => {
  return mapSaavnAlbum(data);
};

export const homeDataMapper = (data: any): HomeData => {
  const modulesArr = [...Object.keys(data?.modules || {}), 'browse_discover'].filter(
    (key) => !excludedKeys?.includes(key),
  );
  const mappedData: HomeSection[] = [];

  if (isArray(modulesArr) && !isEmptyArray(modulesArr)) {
    modulesArr.forEach((module) => {
      let heading = dataExtractor<string>(data?.modules?.[module], saavnDataConfigs.home.heading);
      if (module === 'browse_discover' && !heading) {
        heading = 'Browse';
      }
      if (isArray(data[module]) && !isEmptyArray(data[module]) && heading) {
        const extractedData = data[module]?.map((moduleData: any) => dataSanitizer(moduleData));
        mappedData.push({ heading, data: extractedData, source: 'saavn' });
      }
    });
  }

  return mappedData.filter((d) => !d?.heading?.toLowerCase()?.includes('podcasts'));
};

export const modulesDataMapper = (data: any) => {
  const modulesArr = Object.keys(data || {}).filter((key) => !excludedKeys?.includes(key));
  const mappedData = [];

  modulesArr.forEach((module) => {
    const extractedData = dataExtractor<any>(
      data,
      saavnDataConfigs.moduleConfig[toCamelCase(module)],
    )?.map((moduleData: any) => dataSanitizer(moduleData));

    if (extractedData) {
      mappedData.push({
        heading: toSentenceCase(module),
        data: extractedData,
      });
    }
  });

  return mappedData;
};

export const albumDataMapper = (data: any) => {
  const album = mapSaavnAlbum(data);

  const sections = [];
  if (data.modules) {
    const modules = Object.keys(data.modules).filter((d) => !['artists', 'list'].includes(d));
    for (const key of modules) {
      const temp: any = {};
      for (const k in saavnDataConfigs.albumReco) {
        temp[k] = dataExtractor(data.modules[key], saavnDataConfigs.albumReco[k]);
      }
      sections.push(temp);
    }
  }

  return { ...album, sections };
};

export const playlistDataMapper = (data: any) => {
  const playlist = mapSaavnPlaylist(data);

  const sections = [];
  if (data.modules) {
    const modules = Object.keys(data.modules).filter((d) => !['artists', 'list'].includes(d));
    for (const key of modules) {
      const temp: any = {};
      for (const k in saavnDataConfigs.albumReco) {
        temp[k] = dataExtractor(data.modules[key], saavnDataConfigs.albumReco[k]);
      }
      sections.push(temp);
    }
  }

  return { ...playlist, sections };
};

export const recommendedAlbumDataMapper = (data: any[]) => {
  return (data || []).map((item) => mapSaavnAlbum(item));
};

export const stationSongsMapper = async (data: any) => {
  const songsArr = [];
  for (const item in data) {
    if (data?.[item]?.['song']) {
      songsArr.push(data?.[item]?.['song']);
    }
  }

  const sanitizedData = songDataSanitizer(songsArr);
  return {
    list: sanitizedData,
    id: data.stationid,
  };
};

export const topSearchMapper = (data: any) => {
  const sortedData = {
    albums: { data: [], type: 'album' },
    artists: { data: [], type: 'artist' },
    playlists: { data: [], type: 'playlist' },
    songs: { data: [], type: 'song' },
  };

  (data || []).forEach((d: any) => {
    if (d.type === 'album') sortedData['albums'].data.push(d);
    else if (d.type === 'song') sortedData['songs'].data.push(d);
    else if (d.type === 'artist') sortedData['artists'].data.push(d);
    else if (d.type === 'playlist') sortedData['playlists'].data.push(d);
  });

  return [
    { heading: 'Albums', data: sortedData.albums.data.map(mapSaavnAlbum), source: 'saavn' },
    {
      heading: 'Playlists',
      data: sortedData.playlists.data.map(mapSaavnPlaylist),
      source: 'saavn',
    },
    { heading: 'Artists', data: sortedData.artists.data.map(mapSaavnArtist), source: 'saavn' },
    { heading: 'Songs', data: sortedData.songs.data.map(mapSaavnSong), source: 'saavn' },
  ];
};

const contentKeys = ['topquery', 'albums', 'playlists', 'artists'];

export const autoCompleteDataMapper = (data: any) => {
  const excludedKeys = Object.keys(data || {}).filter(
    (key) => !['episodes', 'shows'].includes(key),
  );

  const sanitizedData = [];
  for (const key of excludedKeys) {
    let mapped: any;
    if (contentKeys.includes(key)) {
      mapped = data[key].data.map((d: any) => {
        if (d.type === 'song') return mapSaavnSong(d);
        if (d.type === 'album') return mapSaavnAlbum(d);
        if (d.type === 'artist') return mapSaavnArtist(d);
        if (d.type === 'playlist') return mapSaavnPlaylist(d);
        return dataSanitizer(d);
      });
    } else if (key === 'songs') {
      mapped = data[key].data.map(mapSaavnSong);
    } else {
      mapped = data[key];
    }

    sanitizedData.push({
      heading: capitalizeFirstLetter(key),
      data: mapped,
      source: 'saavn',
    });
  }

  return sanitizedData;
};

export const similarArtistsDataMapper = (data: any[]) => {
  return (data || []).map(mapSaavnArtist);
};

export const artistDataMapper = (data: any) => {
  const artist = mapSaavnArtist(data);
  const sections = [];

  if (data.modules) {
    for (const key in data.modules as any) {
      const title = data.modules[key].title;
      if (['topSongs', 'singles'].includes(key)) {
        sections.push({ heading: title, data: songDataSanitizer(data[key]), source: 'saavn' });
      } else if (['similarArtists'].includes(key)) {
        sections.push({
          heading: title,
          data: similarArtistsDataMapper(data[key]),
          source: 'saavn',
        });
      } else if (data[key]) {
        sections.push({
          heading: title,
          data: data[key].map((d: any) => {
            if (d.type === 'album') return mapSaavnAlbum(d);
            if (d.type === 'playlist') return mapSaavnPlaylist(d);
            return dataSanitizer(d);
          }),
          source: 'saavn',
        });
      }
    }
  }

  return { ...artist, sections };
};

export const songsDetailsMapper = (data: any) => {
  const songs = songDataSanitizer(data.songs || []);
  const sections = [];
  if (data.modules) {
    for (const key in data.modules) {
      const temp: any = {};
      for (const k in saavnDataConfigs.songDetails) {
        temp[k] = dataExtractor(data.modules[key], saavnDataConfigs.songDetails[k]);
      }
      sections.push(temp);
    }
  }

  return { songs, sections };
};
