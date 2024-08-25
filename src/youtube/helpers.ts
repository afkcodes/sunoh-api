import { ytmDataConfigs } from '../helpers/dataConfig';
import { dataExtractor } from '../helpers/dataExtractor';

const ytmSongDataExtractor = (songs: any) => {
  const extractedSongData = songs.map((song) => {
    const obj = {};
    for (let key in ytmDataConfigs.songConfig) {
      obj[key] = dataExtractor(song, ytmDataConfigs.songConfig[key]);
      obj['type'] = 'song';
    }
    return obj;
  });
  return extractedSongData;
};

const ytmAlbumOrPlaylistDataExtractor = (albumOrPlaylistData: any) => {
  const extractedSongData = albumOrPlaylistData.map((d: any) => {
    const obj = {};
    for (let key in ytmDataConfigs.albumOrPlaylistConfig) {
      obj[key] = dataExtractor(d, ytmDataConfigs.albumOrPlaylistConfig[key]);
    }
    return obj;
  });
  return extractedSongData;
};

const excludedKeys = ['Music videos for you'];

const ytHomeDataExtractor = (data: any) => {
  const results = data?.results.filter((d) => !excludedKeys.includes(d?.title));
  const extractedContentData = results.map((d: any) => {
    const obj = {};
    for (let key in ytmDataConfigs.contentConfig) {
      if (key === 'contents' && d?.[key]?.[0]?.type === 'flat-song') {
        obj[key] = ytmSongDataExtractor(d[key]);
      } else if (key === 'contents' && ['playlist', 'album'].includes(d?.[key]?.[0]?.type)) {
        obj[key] = ytmAlbumOrPlaylistDataExtractor(d[key]);
      } else {
        obj[key] = dataExtractor(d, ytmDataConfigs.contentConfig[key]);
      }
    }
    return obj;
  });

  return extractedContentData;
};

export { ytHomeDataExtractor };
