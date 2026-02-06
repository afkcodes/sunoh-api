import {
  mapGaanaAlbum,
  mapGaanaArtist,
  mapGaanaPlaylist,
  mapGaanaSong,
} from '../mappers/gaana.mapper';
import { Album, Artist, Playlist, Song } from '../types';

export const gaanaDataSanitizer = (data: any): Song | Album | Playlist | Artist | any => {
  const type = data.entity_type;

  if (type === 'TR') return mapGaanaSong(data);
  if (type === 'AL') return mapGaanaAlbum(data);
  if (type === 'PL') return mapGaanaPlaylist(data);
  if (type === 'AR') return mapGaanaArtist(data);

  return data;
};

export const gaanaSearchMapper = (data: any) => {
  const gr = data.gr || [];
  const sanitizedData = [];

  gr.forEach((group: any) => {
    const heading = group.stxt || group.ty;
    const items = (group.gd || []).map((item: any) => {
      // Normalizing search item to match our internal structure
      const normalizedItem = {
        entity_id: item.id,
        name: item.ti,
        seokey: item.seo,
        artwork: item.aw,
        entity_type:
          item.ty === 'Track'
            ? 'TR'
            : item.ty === 'Album'
              ? 'AL'
              : item.ty === 'Playlist'
                ? 'PL'
                : item.ty === 'Artist'
                  ? 'AR'
                  : item.ty,
        language: item.language,
        entity_info: [
          {
            key: 'artist',
            value: (item.sti || '').split(',').map((name: string) => ({ name: name.trim() })),
          },
          { key: 'album', value: [{ name: item.sti }] },
        ],
      };
      return gaanaDataSanitizer(normalizedItem);
    });

    if (items.length > 0) {
      sanitizedData.push({
        heading,
        data: items,
        source: 'gaana',
      });
    }
  });

  return sanitizedData;
};

export const gaanaSectionMapper = (sections: any[]): any[] => {
  return (sections || []).map((section: any) => ({
    heading: section.ga_header || section.entity_description,
    source: 'gaana',
    url: section.url,
    seokey: section.seokey_url,
    entities: section.entities || section.content?.entities,
  }));
};

export const gaanaHomeMapper = (data: any): any[] => {
  return gaanaSectionMapper(data.home);
};
