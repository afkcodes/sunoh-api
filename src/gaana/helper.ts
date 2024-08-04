import { isValidArray } from '../helpers/common';
import { gaanaDataConfigs } from '../helpers/dataConfig';
import { dataExtractor } from '../helpers/dataExtractor';
const ColorThief = require('colorthief');

async function getPalettes(data) {
  const dataWithPalette = [];

  for (const item of data) {
    try {
      const palette = await ColorThief.getPalette(item.image, 5);
      dataWithPalette.push({ ...item, palette });
    } catch (error) {
      console.error(`Error processing ${item}:`, error);
    }
  }
  return dataWithPalette;
}

const radioDataMapper = (data: any, page: number) => {
  if (data.status === 0) {
    return [];
  }

  if (data.entities && isValidArray(data.entities)) {
    const sanitizedData = data.entities.map((radioData) => {
      const extractedData: any = {};
      for (let key in gaanaDataConfigs.radio) {
        extractedData[key] = dataExtractor(radioData, gaanaDataConfigs.radio[key]);
        extractedData.source = 'gaana';
      }
      return extractedData;
    });

    return {
      list: sanitizedData,
      page: Number(page),
      count: data?.count,
    };
  }
};

const songDataMapper = (tracks) => {
  const sanitizedData = tracks.map((track) => {
    const extractedData: any = {};
    for (let key in gaanaDataConfigs.song) {
      extractedData[key] = dataExtractor(track, gaanaDataConfigs.song[key]);
      extractedData.source = 'gaana';
    }

    extractedData.artists = extractedData.artists.map((artist: any) => ({
      id: artist.artist_id,
      name: artist.name,
      type: 'artist',
      key: artist.seokey,
    }));

    extractedData.genres = extractedData.genres.map((genre: any) => ({
      id: genre.genre,
      name: genre.name,
    }));

    return extractedData;
  });
  return sanitizedData;
};

const radioDetailMapper = async (data: any) => {
  const sanitizedSongData = songDataMapper(data.tracks);
  return sanitizedSongData;
};

export { radioDataMapper, radioDetailMapper };
