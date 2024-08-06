import { createDownloadLinks, getToken, toCamelCase, toSentenceCase } from '../helpers/common';
import { saavnDataConfigs } from '../helpers/dataConfig';
import { dataExtractor } from '../helpers/dataExtractor';
import { Quality } from '../helpers/type';
import { isArray, isEmptyArray } from '../helpers/validators';

const excludedKeys = ['browse_discover', 'city_mod'];

const createImageLinks = (link: string): Quality => {
  const qualities = ['50x50', '150x150', '500x500'];

  for (const q of qualities) {
    if (link.includes(q)) {
      return qualities.map((quality) => ({
        quality,
        link: link.replace(q, quality),
      }));
    }
  }

  return link;
};

const dataSanitizer = (data) => {
  const title = dataExtractor(data, saavnDataConfigs.home.title);
  const id = dataExtractor(data, saavnDataConfigs.home.id);
  const subTitle = dataExtractor(data, saavnDataConfigs.home.subtitle);
  const images = createImageLinks(dataExtractor(data, saavnDataConfigs.home.images));
  const isExplicit =
    dataExtractor(data, saavnDataConfigs.home.isExplicit) ||
    dataExtractor(data, saavnDataConfigs.home.moreInfo.isExplicit);
  const playCount = dataExtractor(data, saavnDataConfigs.home.playCount);
  const type = dataExtractor(data, saavnDataConfigs.home.type);
  const language =
    dataExtractor(data, saavnDataConfigs.home.language) ||
    dataExtractor(data, saavnDataConfigs.home.moreInfo.language);
  const editorFirstName = dataExtractor(data, saavnDataConfigs.home.moreInfo.firstName);
  const editorLastName = dataExtractor(data, saavnDataConfigs.home.moreInfo.lastName);
  const editorialLanguage = dataExtractor(data, saavnDataConfigs.home.moreInfo.editorialLanguage);
  const followers = dataExtractor(data, saavnDataConfigs.home.moreInfo.followers);
  const releaseDate = dataExtractor(data, saavnDataConfigs.home.moreInfo.releaseDate);
  const releaseYear = dataExtractor(data, saavnDataConfigs.home.moreInfo.releaseYear);
  const songCount = dataExtractor(data, saavnDataConfigs.home.moreInfo.songCount);
  const description = dataExtractor(data, saavnDataConfigs.home.moreInfo.description);
  const token = getToken(dataExtractor(data, saavnDataConfigs.home.token));
  const artists = dataExtractor<any[]>(data, saavnDataConfigs.home.moreInfo.artists)?.map(
    (artist) => ({
      name: artist.name,
      id: artist.id,
      image: createImageLinks(artist.image),
      type: artist.type,
    }),
  );
  const stationType = dataExtractor(data, saavnDataConfigs.home.moreInfo.stationType);
  const stationDisplayText = dataExtractor(data, saavnDataConfigs.home.moreInfo.stationDisplayText);
  const color = dataExtractor(data, saavnDataConfigs.home.moreInfo.color);

  return {
    id,
    title,
    subTitle,
    images,
    isExplicit,
    playCount,
    type,
    editorFirstName,
    editorLastName,
    followers,
    releaseDate,
    releaseYear,
    songCount,
    language,
    artists,
    description,
    editorialLanguage,
    stationType,
    stationDisplayText,
    color,
    token,
    source: 'saavn',
  };
};

const songDataSanitizer = (data) => {
  const extractedData = data.map((item) => {
    const songData: any = {};
    for (let key in saavnDataConfigs.list) {
      const val =
        key === 'images'
          ? createImageLinks(dataExtractor(item, saavnDataConfigs.list[key]))
          : dataExtractor(item, saavnDataConfigs.list[key]);
      songData[key] = val;
    }
    songData.artists =
      songData?.artists?.map((artist) => ({
        name: artist.name,
        id: artist.id,
        image: createImageLinks(artist.image),
        type: artist.type,
      })) || [];

    songData.token = songData.token ? getToken(songData.token) : '';
    songData.mediaUrls = songData.mediaUrls ? createDownloadLinks(songData?.mediaUrls) : [];
    songData.source = 'saavn';

    return songData;
  });
  return extractedData;
};

const albumDataSanitizer = (data) => {
  const extractedData = {};
  for (let key in saavnDataConfigs.albumConfig) {
    const val =
      key === 'images'
        ? createImageLinks(dataExtractor(data, saavnDataConfigs.albumConfig[key]))
        : dataExtractor(data, saavnDataConfigs.albumConfig[key]);

    extractedData[key] = val;
    if (isArray(val) && key === 'list') {
      extractedData[key] = songDataSanitizer(val);
    }
    if (key === 'token') {
      extractedData[key] = extractedData[key] ? getToken(val as string) : '';
    }
  }
  return extractedData;
};

const homeDataMapper = (data: any) => {
  const modulesArr = Object.keys(data?.modules);
  console.log(modulesArr);
  const mappedData = [];
  if (isArray(modulesArr) && !isEmptyArray(modulesArr)) {
    modulesArr.forEach((module) => {
      const heading = dataExtractor(data?.modules[module], saavnDataConfigs.home.heading);
      if (isArray(data[module]) && !isEmptyArray(data[module])) {
        const extractedData = data[module]?.map((moduleData) => dataSanitizer(moduleData));
        mappedData.push({ heading, data: extractedData, source: 'saavn' });
      }
    });
  }
  return mappedData;
};

const modulesDataMapper = (data: any) => {
  const modulesArr = Object.keys(data).filter((key) => !excludedKeys?.includes(key));
  const mappedData = [];
  modulesArr.forEach((module) => {
    const extractedData = dataExtractor<any>(
      data,
      saavnDataConfigs.moduleConfig[toCamelCase(module)],
    )?.map((moduleData) => dataSanitizer(moduleData));
    mappedData.push({
      heading: toSentenceCase(module),
      data: extractedData,
    });
  });
  return mappedData;
};

const albumDataMapper = (data: any) => {
  const extractedData = albumDataSanitizer(data);
  return extractedData;
};

const recommendedAlbumDataMapper = (data: any) => {
  const mappedData = data.map((item) => albumDataMapper(item));
  return mappedData;
};

const stationSongsMapper = async (data: any) => {
  let songsArr = [];
  for (let item in data) {
    if (data?.[item]?.['song']) {
      songsArr.push(data?.[item]?.['song']);
    }
  }

  const sanitizedData = songDataSanitizer(songsArr);
  // const dataWithPalette = await getPalettes(sanitizedData);
  return {
    list: sanitizedData,
    id: data.stationid,
  };
};

const topSearchMapper = (data: any) => {
  const sortedData = {
    albums: { data: [], type: '' },
    artists: { data: [], type: '' },
    playlists: { data: [], type: '' },
    songs: { data: [], type: '' },
  };
  data.forEach((d) => {
    if (d.type === 'album') {
      sortedData['albums'].data.push(d);
      sortedData['albums'].type = 'album';
    }
    if (d.type === 'song') {
      sortedData['songs'].data.push(d);
      sortedData['songs'].type = 'song';
    }
    if (d.type === 'artist') {
      sortedData['artists'].data.push(d);
      sortedData['artists'].type = 'artist';
    }
    if (d.type === 'playlist') {
      sortedData['playlists'].data.push(d);
      sortedData['playlists'].type = 'playlist';
    }
  });

  const mappedData = {
    albums: {
      ...sortedData.albums,
      data: sortedData.albums.data.map((d) => albumDataMapper(d)),
    },
    playlists: {
      ...sortedData.playlists,
      data: sortedData.playlists.data.map((d) => albumDataMapper(d)),
    },
    artists: {
      ...sortedData.artists,
      data: sortedData.artists.data.map((d) => albumDataMapper(d)),
    },
    songs: {
      ...sortedData.songs,
      data: songDataSanitizer(sortedData.songs.data),
    },
  };

  return [mappedData.albums, mappedData.playlists, mappedData.artists, mappedData.songs];
};

const contentKeys = ['albums', 'playlists', 'artists'];

const autoCompleteDataMapper = (data) => {
  const excludedKeys = Object.keys(data).filter((key) => !['episodes', 'shows'].includes(key));
  const filteredData = {};
  for (let key of excludedKeys) {
    filteredData[key] = contentKeys.includes(key)
      ? data[key].data.map((d) => albumDataMapper(d))
      : key === 'songs'
        ? songDataSanitizer(data[key].data)
        : data[key];
  }

  return filteredData;
};

export {
  albumDataMapper,
  autoCompleteDataMapper,
  homeDataMapper,
  modulesDataMapper,
  recommendedAlbumDataMapper,
  stationSongsMapper,
  topSearchMapper,
};
