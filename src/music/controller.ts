import { FastifyReply, FastifyRequest } from 'fastify';
import {
  radioStationsController as gaanaRadioStationsController,
  getGaanaHomeData,
  getGaanaSearchData,
  getGaanaTrendingSearchData,
} from '../gaana/controller';
import { capitalizeFirstLetter, detectLanguage, isValidTitle } from '../helpers/common';
import { cache } from '../redis';
import {
  getSaavnHomeData,
  getSaavnSearchData,
  getSaavnSongRecommendData,
  getSaavnTopSearchData,
  artistStationController as saavnArtistStationController,
  featuredStationsController as saavnFeaturedStationsController,
  stationController as saavnStationController,
  stationSongsController as saavnStationSongsController,
} from '../saavn/controller';
import { sendError, sendSuccess } from '../utils/response';

export const unifiedRadioSessionController = async (req: FastifyRequest, res: FastifyReply) => {
  const { id, type = 'song', provider, name, query } = req.query as any;
  const languages = (req.query as any).lang || (req.query as any).languages || 'hindi,english';

  try {
    // 1. Gaana: No creation step needed, just return ID prefixed
    if (provider === 'gaana') {
      return sendSuccess(res, { stationId: `gaana_${id}` }, 'Radio session created', 'unified');
    }

    // 2. Saavn: Needs station creation
    const mockRes = {
      code: () => ({
        send: (data: any) => data,
      }),
    } as any;

    let stationId = '';

    if (type === 'artist') {
      // Create Artist Station
      const mockReq = {
        query: { artistId: id, name: name || query, lang: languages },
      } as any;
      const resp = (await saavnArtistStationController(mockReq, mockRes)) as any;
      if (resp?.status === 'success') stationId = resp.data.stationid;
    } else if (type === 'featured') {
      // Create Featured Station
      const mockReq = {
        query: { name: name || query || id, lang: languages },
      } as any;
      const resp = (await saavnStationController(mockReq, mockRes)) as any;
      if (resp?.status === 'success') stationId = resp.data.stationid;
    } else {
      // Create Entity Station (Song/Entity)
      const mockReq = {
        query: { entityId: id, entityType: type, lang: languages },
      } as any;
      // Using saavnStationController from import which maps to createEntityStation usually or we check imports
      // In imports: stationController as saavnStationController.
      // Wait, saavnStationController in controller.ts (line 350) is for FEATURED stations.
      // We need entityStationController for songs.
      // Let's check imports in music/controller.ts

      const { entityStationController } = require('../saavn/controller');
      const resp = (await entityStationController(mockReq, mockRes)) as any;
      if (resp?.status === 'success') stationId = resp.data.stationid;
    }

    if (!stationId) {
      return sendError(res, 'Failed to create Saavn station');
    }

    return sendSuccess(
      res,
      { stationId: `saavn_${stationId}` },
      'Radio session created',
      'unified',
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to init radio session', error);
  }
};

export const unifiedRadioPlayController = async (req: FastifyRequest, res: FastifyReply) => {
  const { sessionId } = req.params as any;
  const { k, count, next } = req.query as any;
  const languages = (req.query as any).lang || (req.query as any).languages || 'hindi,english';

  try {
    const mockRes = {
      code: () => ({
        send: (data: any) => data,
      }),
    } as any;

    // GAANA
    if (sessionId.startsWith('gaana_')) {
      const radioId = sessionId.replace('gaana_', '');
      const mockReq = {
        params: { radioId },
        query: { lang: languages },
      } as any;

      const resp = (await gaanaRadioStationsController(mockReq, mockRes)) as any;
      // gaanaRadioStationsController -> radioDetailController (imported as such?)
      // In imports: radioStationsController as gaanaRadioStationsController
      // Wait, gaana/controller.ts has:
      // radioStationsController (fetches LIST of stations)
      // radioDetailController (fetches SONGS of a station)
      // I need radioDetailController.

      const { radioDetailController } = require('../gaana/controller');
      const detailResp = (await radioDetailController(mockReq, mockRes)) as any;

      if (detailResp?.status === 'success') {
        return sendSuccess(res, detailResp.data, 'Radio songs fetched', 'unified');
      }
      return sendError(res, 'Failed to fetch Gaana radio songs');
    }

    // SAAVN
    if (sessionId.startsWith('saavn_')) {
      const stationId = sessionId.replace('saavn_', '');
      const mockReq = {
        params: { stationId },
        query: { count: count || k, next, lang: languages },
      } as any;

      const resp = (await saavnStationSongsController(mockReq, mockRes)) as any;
      if (resp?.status === 'success') {
        return sendSuccess(res, resp.data, 'Radio songs fetched', 'unified');
      }
      return sendError(res, 'Failed to fetch Saavn radio songs');
    }

    return sendError(res, 'Invalid session ID format');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch radio songs', error);
  }
};

export const unifiedArtistRadioController = async (req: FastifyRequest, res: FastifyReply) => {
  const { artistId } = req.params as any;
  const { q, query, lang, type } = req.query as any;
  const searchQuery = q || query;
  let languages = lang || (req.query as any).languages || detectLanguage(searchQuery);

  // Default languages if none detected or provided
  if (!languages) languages = 'hindi,english';

  try {
    const mockRes = {
      code: () => ({
        send: (data: any) => data,
      }),
    } as any;

    // Explicit Type Handling
    if (type === 'featured') {
      const stationIdentifier = artistId || searchQuery;
      // 1. Try treating artistId as a direct Station ID
      const songsReq = {
        query: { stationId: stationIdentifier, count: 20, lang: languages, ...(req.query as any) },
      } as any;
      const songsRes = (await saavnStationSongsController(songsReq, mockRes)) as any;

      if (songsRes.status === 'success' && songsRes.data?.list?.length > 0) {
        return sendSuccess(
          res,
          {
            stationId: stationIdentifier,
            list: songsRes.data.list,
          },
          'Featured radio fetched successfully',
          'unified',
        );
      }

      // 2. If valid songs not found, try creating a featured station by name
      // (This handles cases where ID is just the name like "Punjabi Retro")
      const featuredReq = {
        query: { name: stationIdentifier, lang: languages },
      } as any;

      const featuredRes = (await saavnStationController(featuredReq, mockRes)) as any;

      if (featuredRes && featuredRes.status === 'success' && featuredRes.data?.stationid) {
        const stationId = featuredRes.data.stationid;
        const songsReq2 = {
          query: { stationId, count: 20, lang: languages },
        } as any;
        const songsRes2 = (await saavnStationSongsController(songsReq2, mockRes)) as any;

        if (songsRes2.status === 'success') {
          return sendSuccess(
            res,
            {
              stationId,
              list: songsRes2.data.list,
            },
            'Featured radio (by name) fetched successfully',
            'unified',
          );
        }
      }
    }

    let targetArtistId = artistId;
    let artistName = searchQuery;

    // If no artistId (or type mismatch) but search query is provided, find the best match on Saavn
    if (!targetArtistId && searchQuery) {
      // 1. Try if it's a Featured Station (e.g. "Punjabi Covers")
      const featuredReq = {
        query: { name: searchQuery, lang: languages },
      } as any;

      const featuredRes = (await saavnStationController(featuredReq, mockRes)) as any;

      if (featuredRes && featuredRes.status === 'success' && featuredRes.data?.stationid) {
        const stationId = featuredRes.data.stationid;
        const songsReq = {
          query: { stationId, count: 20, lang: languages },
        } as any;
        const songsRes = (await saavnStationSongsController(songsReq, mockRes)) as any;

        if (songsRes.status === 'success' && songsRes.data?.list?.length > 0) {
          return sendSuccess(
            res,
            {
              stationId,
              list: songsRes.data.list,
            },
            'Radio tracks fetched successfully',
            'unified',
          );
        }
        console.log(
          `⚠️ Featured station "${searchQuery}" found but returned 0 songs. Falling back to artist search.`,
        );
      }

      // 2. If not a featured station, find the best Artist match
      const searchResults = await getSaavnSearchData(searchQuery, 'artists', 1, 1, languages);
      if (
        searchResults &&
        !Array.isArray(searchResults) &&
        searchResults.list &&
        searchResults.list.length > 0
      ) {
        targetArtistId = searchResults.list[0].id;
        artistName = searchResults.list[0].title || searchResults.list[0].name;
      }
    }

    if (!targetArtistId) {
      return sendError(res, 'Could not identify an artist for radio');
    }

    // Use Saavn to create artist station
    const mockReq = {
      query: { artistId: targetArtistId, name: artistName, lang: languages },
    } as any;

    const stationRes = (await saavnArtistStationController(mockReq, mockRes)) as any;

    if (stationRes && stationRes.status === 'success' && stationRes.data?.stationid) {
      const stationId = stationRes.data.stationid;

      // Fetch the first batch of songs immediately
      const songsReq = {
        query: { stationId, count: 20, lang: languages },
      } as any;
      const songsRes = (await saavnStationSongsController(songsReq, mockRes)) as any;

      return sendSuccess(
        res,
        {
          stationId,
          list: songsRes.status === 'success' ? songsRes.data.list : [],
        },
        'Artist radio fetched successfully',
        'unified',
      );
    }

    return sendError(res, 'Failed to create artist radio');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch artist radio', error);
  }
};

export const unifiedRadioController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  const languages = lang || (req.query as any).languages;

  try {
    // Create mock objects to call controllers
    const mockRes = (source: string) =>
      ({
        code: () => ({
          send: (data: any) => data,
        }),
      }) as any;

    const [saavnRes, gaanaRes] = await Promise.allSettled([
      saavnFeaturedStationsController(req as any, mockRes('saavn')),
      gaanaRadioStationsController(req as any, mockRes('gaana')),
    ]);

    let saavnStations =
      saavnRes.status === 'fulfilled' && (saavnRes.value as any).status === 'success'
        ? (saavnRes.value as any).data
        : [];

    let gaanaStationsRaw =
      gaanaRes.status === 'fulfilled' && (gaanaRes.value as any).status === 'success'
        ? (gaanaRes.value as any).data
        : [];

    // Flatten Gaana sections into a single list of radio stations
    const gaanaStations = gaanaStationsRaw.reduce((acc: any[], section: any) => {
      if (section.data) acc.push(...section.data);
      return acc;
    }, []);

    const finalData = [];
    const maxLen = Math.max(saavnStations.length, gaanaStations.length);
    for (let i = 0; i < maxLen; i++) {
      if (saavnStations[i]) finalData.push({ ...saavnStations[i], source: 'saavn' });
      if (gaanaStations[i]) finalData.push({ ...gaanaStations[i], source: 'gaana' });
    }

    return sendSuccess(res, finalData, 'Radio stations fetched successfully', 'unified');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch unified radio stations', error);
  }
};

export const unifiedSongRecommendController = async (req: FastifyRequest, res: FastifyReply) => {
  const { songId } = req.params as any;
  const { q, query, lang } = req.query as any;
  const searchQuery = q || query;
  const languages = lang || (req.query as any).languages;

  try {
    let targetSongId = songId;

    // If no songId but search query is provided, find the best match on Saavn
    if (!targetSongId && searchQuery) {
      const searchResults = await getSaavnSearchData(searchQuery, 'songs', 1, 1, languages);
      if (
        searchResults &&
        !Array.isArray(searchResults) &&
        searchResults.list &&
        searchResults.list.length > 0
      ) {
        targetSongId = searchResults.list[0].id;
      }
    }

    if (!targetSongId) {
      return sendError(res, 'Could not identify a song for recommendations');
    }

    const data = await getSaavnSongRecommendData(targetSongId, languages);

    return sendSuccess(res, data, 'Recommendations fetched successfully', 'unified');
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to fetch recommendations', error);
  }
};

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
