import { FastifyReply, FastifyRequest } from 'fastify';
import { getGaanaHomeData } from '../gaana/controller';
import { getSaavnHomeData } from '../saavn/controller';
import { sendError, sendSuccess } from '../utils/response';

export const unifiedHomeController = async (req: FastifyRequest, res: FastifyReply) => {
  const { lang } = req.query as any;
  const languages = lang || (req.query as any).languages;

  try {
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
        mergedCategories.get(cat).data.push(...section.data);
      } else {
        otherSections.push(section);
      }
    });

    // Process Gaana
    gaanaData.forEach((section) => {
      const cat = getCategory(section.heading);
      if (cat) {
        if (!mergedCategories.has(cat)) {
          mergedCategories.set(cat, { heading: cat, data: [], source: 'unified' });
        }
        // Interleave Gaana items with existing Saavn items for the same category
        const existingData = mergedCategories.get(cat).data;
        const newData = [];
        const maxLen = Math.max(existingData.length, section.data.length);
        for (let i = 0; i < maxLen; i++) {
          if (existingData[i]) newData.push(existingData[i]);
          if (section.data[i]) newData.push(section.data[i]);
        }
        mergedCategories.get(cat).data = newData;
      } else {
        otherSections.push(section);
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
