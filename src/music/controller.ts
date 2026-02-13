import { FastifyReply, FastifyRequest } from 'fastify';
import {
  getGaanaHomeData,
  getGaanaSearchData,
  getGaanaTrendingSearchData,
} from '../gaana/controller';
import { capitalizeFirstLetter, isValidTitle } from '../helpers/common';
import { cache } from '../redis';
import { getSaavnHomeData, getSaavnSearchData, getSaavnTopSearchData } from '../saavn/controller';
import { sendError, sendSuccess } from '../utils/response';

export const unifiedHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  const languages = lang || (req.query as any).languages;
  const cacheKey = `unified_home_v3_${languages || 'default'}`;

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
      if (!section || !Array.isArray(section.data)) return;

      const cat = getCategory(section.heading);
      if (cat) {
        if (!mergedCategories.has(cat)) {
          mergedCategories.set(cat, { heading: cat, data: [], source: 'unified' });
        }
        const filteredData = section.data.filter(
          (item: any) => item && isValidTitle(item.title || item.name),
        );
        mergedCategories.get(cat).data.push(...filteredData);
      } else {
        const filteredSection = {
          ...section,
          data: section.data.filter((item: any) => item && isValidTitle(item.title || item.name)),
        };
        if (filteredSection.data.length > 0) {
          otherSections.push(filteredSection);
        }
      }
    });

    // Process Gaana
    gaanaData.forEach((section) => {
      if (!section || !Array.isArray(section.data)) return;

      const cat = getCategory(section.heading);
      if (cat) {
        if (!mergedCategories.has(cat)) {
          mergedCategories.set(cat, { heading: cat, data: [], source: 'unified' });
        }
        const existingData = mergedCategories.get(cat).data;
        const newData = [];
        const filteredGaana = section.data.filter(
          (item: any) => item && isValidTitle(item.title || item.name),
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
          data: section.data.filter((item: any) => item && isValidTitle(item.title || item.name)),
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
  const cacheKey = `unified_search_v6_${q}_${type}_${page}_${count}_${languages || 'default'}`;

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

    // Helper to deduplicate by normalized title and artist
    const dedupe = (items: any[]) => {
      if (!Array.isArray(items)) return [];
      const seen = new Set();
      return items.filter((item) => {
        if (!item) return false;
        const title = (item.title || item.name || '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]/g, '');
        let artist = '';
        if (Array.isArray(item.artists) && item.artists.length > 0) {
          artist = (item.artists[0].name || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, '');
        } else if (typeof item.subtitle === 'string') {
          artist = item.subtitle
            .split(',')[0]
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, '');
        }

        const key = `${title}_${artist}`;
        if (!title || !isValidTitle(item.title || item.name) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const normalizeHeading = (h: string) => {
      let cleaned = h.toLowerCase().trim().replace(/ /g, '');
      if (cleaned === 'track' || cleaned === 'song') cleaned = 'songs';
      if (cleaned === 'album') cleaned = 'albums';
      if (cleaned === 'playlist') cleaned = 'playlists';
      if (cleaned === 'artist') cleaned = 'artists';
      if (cleaned === 'topquery' || cleaned === 'topresult') cleaned = 'topresults';
      return cleaned;
    };

    if (type === 'all' && Array.isArray(saavnResults)) {
      // Create a map of Gaana sections for easier lookup
      const gaanaSectionMap = new Map();
      gaanaResults.forEach((g: any) => {
        if (!g || !g.heading) return;
        const normalized = normalizeHeading(g.heading);
        gaanaSectionMap.set(normalized, g);
      });

      // Find Saavn's Top results / Top query
      const topIdx = saavnResults.findIndex(
        (s: any) =>
          normalizeHeading(s.heading) === 'topresults' ||
          normalizeHeading(s.heading) === 'topquery',
      );

      // 1. Process Gaana's "All" section as the new Hero/Top Result
      const gaanaAll = gaanaSectionMap.get('all') || gaanaSectionMap.get('topresults');
      if (gaanaAll) {
        const heroSection = {
          heading: 'Top Results',
          data: dedupe(gaanaAll.data),
          source: 'gaana',
        };

        if (topIdx !== -1) {
          saavnResults[topIdx] = heroSection;
        } else {
          saavnResults.unshift(heroSection);
        }
      }

      // 2. Comprehensive Merge for all major categories
      const categories = ['songs', 'albums', 'artists', 'playlists'];
      const sResults = saavnResults as any[];

      categories.forEach((cat) => {
        const gSec = gaanaSectionMap.get(cat);
        if (gSec) {
          const sSec = sResults.find((s) => normalizeHeading(s.heading) === cat);
          if (sSec) {
            // Merge Gaana items into Saavn section
            const combined = [...sSec.data, ...dedupe(gSec.data)];
            sSec.data = dedupe(combined);
            sSec.source = 'unified';
          } else {
            // Add new section if it doesn't exist in Saavn
            sResults.push({
              heading: capitalizeFirstLetter(cat),
              data: dedupe(gSec.data),
              source: 'gaana',
            });
          }
        }
      });

      // Final dedupe of all sections
      saavnResults = sResults.map((s: any) => ({ ...s, data: dedupe(s.data) }));
    } else if (type === 'playlists' && (saavnResults as any).list) {
      const playlistList = dedupe((saavnResults as any).list);
      gaanaResults.forEach((gSec: any) => {
        if (gSec && ['Playlists', 'Mix'].includes(gSec.heading)) {
          playlistList.push(...dedupe(gSec.data));
        }
      });
      (saavnResults as any).list = dedupe(playlistList);
      (saavnResults as any).source = 'unified';
    } else if ((saavnResults as any).list) {
      // Dedupe and filter for object-style results (songs, albums, etc.)
      (saavnResults as any).list = dedupe((saavnResults as any).list);

      // Try to merge matching Gaana categories if they exist
      const matchingGaana = gaanaResults.find(
        (gSec: any) =>
          gSec &&
          gSec.heading &&
          normalizeHeading(gSec.heading) === normalizeHeading(type.toString()),
      );
      if (matchingGaana) {
        const combined = [...((saavnResults as any).list || []), ...dedupe(matchingGaana.data)];
        (saavnResults as any).list = dedupe(combined);
        (saavnResults as any).source = 'unified';
      }
    } else if (Array.isArray(saavnResults)) {
      saavnResults = saavnResults.map((s: any) => ({ ...s, data: dedupe(s.data) }));
    }

    await cache.set(cacheKey, saavnResults, 7200);
    return sendSuccess(res, saavnResults, 'Search results fetched successfully', 'unified');
  } catch (error: any) {
    return sendError(res, error.message || 'Unified search failed', error);
  }
};
