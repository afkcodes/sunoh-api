import { FastifyReply, FastifyRequest } from 'fastify';
import {
  getGaanaHomeData,
  getGaanaSearchData,
  getGaanaTrendingSearchData,
} from '../gaana/controller';
import { isValidTitle } from '../helpers/common';
import { cache } from '../redis';
import { getSaavnHomeData, getSaavnSearchData, getSaavnTopSearchData } from '../saavn/controller';
import { sendError, sendSuccess } from '../utils/response';

export const unifiedHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  const languages = lang || (req.query as any).languages;
  const cacheKey = `unified_home_v2_${languages || 'default'}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'unified');

    const [saavnHome, gaanaHome] = await Promise.allSettled([
      getSaavnHomeData(languages),
      getGaanaHomeData(lang),
    ]);

    const saavnData: any[] = saavnHome.status === 'fulfilled' ? saavnHome.value : [];
    const gaanaData: any[] = gaanaHome.status === 'fulfilled' ? gaanaHome.value : [];

    // Map of normalized headings to category names for merging
    const categoryMap: Record<string, string> = {
      'new releases': 'New Releases',
      'top charts': 'Top Charts',
      'city top charts': 'Top Charts',
      'trending now': 'Trending',
      'trending songs': 'Trending',
      'top picks': 'Recommended',
      'gaana recommends': 'Recommended',
      'editorial picks': 'Editorial Picks',
      'radio stations': 'Radio',
      radio: 'Radio',
    };

    const mergedCategories = new Map<string, any>();
    const otherSections: any[] = [];

    // Helper to find category
    const getCategory = (h: string) => categoryMap[h.toLowerCase().trim()];

    // Process Saavn
    saavnData.forEach((section) => {
      const cat = getCategory(section.heading);
      if (cat) {
        if (!mergedCategories.has(cat)) {
          mergedCategories.set(cat, { heading: cat, data: [], source: 'unified' });
        }
        const filteredData = section.data.filter((item: any) =>
          isValidTitle(item.title || item.name),
        );
        mergedCategories.get(cat).data.push(...filteredData);
      } else {
        const filteredSection = {
          ...section,
          data: section.data.filter((item: any) => isValidTitle(item.title || item.name)),
        };
        if (filteredSection.data.length > 0) {
          otherSections.push(filteredSection);
        }
      }
    });

    // Process Gaana
    gaanaData.forEach((section) => {
      const cat = getCategory(section.heading);
      if (cat) {
        const existingData = mergedCategories.get(cat).data;
        const newData = [];
        const filteredGaana = section.data.filter((item: any) =>
          isValidTitle(item.title || item.name),
        );
        const maxLen = Math.max(existingData.length, filteredGaana.length);
        for (let i = 0; i < maxLen; i++) {
          if (existingData[i]) newData.push(existingData[i]);
          if (filteredGaana[i]) newData.push(filteredGaana[i]);
        }
        mergedCategories.get(cat).data = newData;
      } else {
        const filteredSection = {
          ...section,
          data: section.data.filter((item: any) => isValidTitle(item.title || item.name)),
        };
        if (filteredSection.data.length > 0) {
          otherSections.push(filteredSection);
        }
      }
    });

    // Priority for certain categories
    const priority = ['Trending', 'Top Charts', 'New Releases', 'Recommended'];
    const finalData: any[] = [];

    // Add prioritized merged categories
    priority.forEach((p) => {
      if (mergedCategories.has(p)) {
        finalData.push(mergedCategories.get(p));
        mergedCategories.delete(p);
      }
    });

    // Add remaining merged categories
    mergedCategories.forEach((section) => finalData.push(section));

    // Interleave remaining "other" sections
    const saavnOthers = otherSections.filter((s) => s.source === 'saavn');
    const gaanaOthers = otherSections.filter((s) => s.source === 'gaana');
    const maxOthers = Math.max(saavnOthers.length, gaanaOthers.length);

    for (let i = 0; i < maxOthers; i++) {
      if (saavnOthers[i]) finalData.push(saavnOthers[i]);
      if (gaanaOthers[i]) finalData.push(gaanaOthers[i]);
    }

    return sendSuccess(res, finalData, 'Unified home data fetched successfully', 'unified');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch unified home data', error);
  }
};
export const unifiedSearchController = async (req: FastifyRequest, res: FastifyReply) => {
  const query = req.query as any;
  const q = query.q || query.query || '';
  const { lang, type = 'all', page = 1, count = 20 } = query;
  const languages = lang || query.languages;

  const cacheKey = `unified_search_v2_${q}_${type}_${page}_${count}_${languages || 'default'}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) return sendSuccess(res, cached, 'OK (Cached)', 'unified');

    if (!q) {
      // Trending/Top Search when no query is provided
      const [saavnTop, gaanaTrending] = await Promise.allSettled([
        getSaavnTopSearchData(languages),
        getGaanaTrendingSearchData(lang),
      ]);

      const saavnData = saavnTop.status === 'fulfilled' ? saavnTop.value : [];
      const gaanaData =
        gaanaTrending.status === 'fulfilled'
          ? gaanaTrending.value.filter((item: any) => isValidTitle(item.title || item.name))
          : [];

      if (gaanaData.length > 0) {
        // Add Gaana trending as a new section or merge into Saavn categories
        // For now, let's add it as a "Trending on Gaana" section
        saavnData.unshift({
          heading: 'Trending on Gaana',
          data: gaanaData,
          source: 'gaana',
        });
      }

      await cache.set(cacheKey, saavnData, 7200);
      return sendSuccess(res, saavnData, 'Top search results fetched successfully', 'unified');
    }

    const [saavnSearch, gaanaSearch] = await Promise.allSettled([
      getSaavnSearchData(q, type, Number(page), Number(count), languages),
      getGaanaSearchData(q, lang),
    ]);

    const gaanaResults = gaanaSearch.status === 'fulfilled' ? gaanaSearch.value : [];
    let saavnResults = saavnSearch.status === 'fulfilled' ? saavnSearch.value : [];

    // Helper to deduplicate by id and normalized title
    const dedupe = (items: any[]) => {
      const seen = new Set();
      return items.filter((item) => {
        const title = (item.title || item.name || '').toLowerCase().trim();
        const id = item.id;
        const key = `${id}_${title}`;
        if (!title || !isValidTitle(title) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    if (type === 'all' && Array.isArray(saavnResults)) {
      saavnResults = saavnResults.map((s: any) => ({ ...s, data: dedupe(s.data) }));

      const playlistSection = saavnResults.find((s: any) => s.heading === 'Playlists');

      if (playlistSection) {
        gaanaResults.forEach((gSec: any) => {
          if (['Playlists', 'Mix'].includes(gSec.heading)) {
            playlistSection.data.push(...dedupe(gSec.data));
          }
        });
        playlistSection.data = dedupe(playlistSection.data);
        playlistSection.source = 'unified';
      } else {
        const gaanaPlaylists = gaanaResults.find((gSec: any) =>
          ['Playlists', 'Mix'].includes(gSec.heading),
        );
        if (gaanaPlaylists) {
          saavnResults.push({ ...gaanaPlaylists, data: dedupe(gaanaPlaylists.data) });
        }
      }
    } else if (type === 'playlists' && (saavnResults as any).list) {
      const playlistList = dedupe((saavnResults as any).list);
      gaanaResults.forEach((gSec: any) => {
        if (['Playlists', 'Mix'].includes(gSec.heading)) {
          playlistList.push(...dedupe(gSec.data));
        }
      });
      (saavnResults as any).list = dedupe(playlistList);
      (saavnResults as any).source = 'unified';
    } else if (Array.isArray(saavnResults)) {
      saavnResults = saavnResults.map((s: any) => ({ ...s, data: dedupe(s.data) }));
    }

    await cache.set(cacheKey, saavnResults, 7200);
    return sendSuccess(res, saavnResults, 'Search results fetched successfully', 'unified');
  } catch (error: any) {
    return sendError(res, error.message || 'Unified search failed', error);
  }
};
