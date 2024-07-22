import { toCamelCase, toSentenceCase } from '../helpers/common';
import { saavnDataConfigs } from '../helpers/dataConfig';
import { dataExtractor } from '../helpers/dataExtractor';
import { Quality } from '../helpers/type';
import { isArray, isEmptyArray } from '../helpers/validators';

const excludedKeys = ['browse_discover'];

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
  const language = dataExtractor(data, saavnDataConfigs.home.language);
  const editorFirstName = dataExtractor(data, saavnDataConfigs.home.moreInfo.firstName);
  const editorLastName = dataExtractor(data, saavnDataConfigs.home.moreInfo.lastName);
  const editorialLanguage = dataExtractor(data, saavnDataConfigs.home.moreInfo.editorialLanguage);
  const followers = dataExtractor(data, saavnDataConfigs.home.moreInfo.followers);
  const releaseDate = dataExtractor(data, saavnDataConfigs.home.moreInfo.releaseDate);
  const releaseYear = dataExtractor(data, saavnDataConfigs.home.moreInfo.releaseYear);
  const songCount = dataExtractor(data, saavnDataConfigs.home.moreInfo.songCount);
  const description = dataExtractor(data, saavnDataConfigs.home.moreInfo.description);
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

    if (isArray(val) && key === 'list') {
      extractedData[key] = songDataSanitizer(val);
    } else {
      extractedData[key] = val;
    }
  }
  return extractedData;
};

const homeDataMapper = (data: any) => {
  const modulesArr = Object.keys(data?.modules);
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

export { albumDataMapper, homeDataMapper, modulesDataMapper };
