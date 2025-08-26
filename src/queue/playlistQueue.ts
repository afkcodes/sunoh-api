import { EventEmitter } from 'events';
import { mapTracks } from '../spotify_import/maptoSaavn';
import { extractPlaylistId, scrapePlaylist } from '../spotify_import/spotify_playlist';

// Define job data interface
interface PlaylistMappingJobData {
  jobId: string;
  url: string;
  options: {
    fast?: boolean;
    debug?: boolean;
    limit?: number;
  };
  userId?: string; // Optional user identifier
}

interface PlaylistMappingResult {
  source: {
    playlistId: string;
    name: string;
    trackCount: number;
  };
  generatedAt: string;
  params: {
    limit?: number;
    minScore: number;
  };
  summary: {
    processed: number;
    matched: number;
    lowConfidence: number;
    noMatch: number;
  };
  items: Array<{
    spotify: any;
    query: string;
    attempts: number;
    candidatesConsidered: number;
    match: any;
    score: number;
    status: string;
  }>;
}

interface Job {
  id: string;
  data: PlaylistMappingJobData;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  result?: PlaylistMappingResult;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Simple in-memory job queue
class InMemoryQueue extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private waitingJobs: string[] = [];
  private activeJobs: Set<string> = new Set();
  private isProcessing = false;

  async addJob(data: PlaylistMappingJobData): Promise<{ jobId: string; isExisting: boolean }> {
    // Check if this job already exists
    const existingJob = this.jobs.get(data.jobId);

    if (existingJob) {
      // If job is still active/waiting, return the existing job
      if (existingJob.status === 'waiting' || existingJob.status === 'active') {
        console.log(
          `[Queue] Job ${data.jobId} already in queue with status: ${existingJob.status}`,
        );
        return { jobId: data.jobId, isExisting: true };
      }

      // If job completed recently (within 10 minutes) and has same options, return existing
      if (existingJob.status === 'completed' && existingJob.completedAt) {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const hasSimilarOptions = this.optionsMatch(existingJob.data.options, data.options);

        if (existingJob.completedAt > tenMinutesAgo && hasSimilarOptions) {
          console.log(
            `[Queue] Job ${data.jobId} recently completed with similar options, returning existing result`,
          );
          return { jobId: data.jobId, isExisting: true };
        }
      }

      // Remove old job and create new one
      console.log(`[Queue] Replacing old job ${data.jobId} (status: ${existingJob.status})`);
      this.jobs.delete(data.jobId);
      // Remove from waiting queue if it's there
      const waitingIndex = this.waitingJobs.indexOf(data.jobId);
      if (waitingIndex > -1) {
        this.waitingJobs.splice(waitingIndex, 1);
      }
    }

    const job: Job = {
      id: data.jobId,
      data,
      status: 'waiting',
      progress: 0,
      createdAt: new Date(),
    };

    this.jobs.set(job.id, job);
    this.waitingJobs.push(job.id);

    console.log(`[Queue] Added new job ${job.id} to queue`);

    // Start processing if not already processing
    if (!this.isProcessing) {
      this.processJobs();
    }

    return { jobId: job.id, isExisting: false };
  }

  private optionsMatch(existingOptions: any, newOptions: any): boolean {
    // Compare key options that affect the result
    return (
      existingOptions.limit === newOptions.limit && existingOptions.fast === newOptions.fast
      // Note: debug option doesn't affect results, so we ignore it
    );
  }
  private async processJobs() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.waitingJobs.length > 0) {
      const jobId = this.waitingJobs.shift()!;
      const job = this.jobs.get(jobId);

      if (!job) continue;

      this.activeJobs.add(jobId);
      job.status = 'active';
      job.startedAt = new Date();

      console.log(`[Queue] Processing job ${jobId}`);

      try {
        // Update progress
        this.updateProgress(jobId, 10);

        const { url, options } = job.data;

        if (options.debug) {
          console.log(`[Queue] Processing job ${jobId}: ${url}`);
        }

        // Extract playlist ID for validation
        const playlistId = extractPlaylistId(url);
        if (!playlistId) {
          throw new Error('Invalid playlist URL - could not extract playlist ID');
        }

        // Scraping options
        const scrapeOptions = {
          headless: true, // Always headless for background jobs
          debug: options.debug || false,
          timeout: 60000, // Increased timeout for background processing
          fast: options.fast || false,
        };

        // Update progress - starting scrape
        this.updateProgress(jobId, 20);

        // Scrape the playlist
        const playlistData = await scrapePlaylist(url, scrapeOptions);

        if (options.debug) {
          console.log(`[Queue] Scraped ${playlistData.tracks.length} tracks for job ${jobId}`);
        }

        // Update progress - starting mapping
        this.updateProgress(jobId, 40);

        // Mapping options
        const mappingOptions = {
          debug: options.debug || false,
          limit: options.limit,
        };

        // Map tracks to Saavn
        const mappedTracks = await mapTracks(playlistData.tracks, mappingOptions);

        // Update progress - processing results
        this.updateProgress(jobId, 80);

        // Calculate statistics
        const matched = mappedTracks.filter((m) => m.saavnBest !== null).length;
        const processed = mappedTracks.length;
        const noMatch = processed - matched;

        // Transform to the required format
        const transformedItems = mappedTracks.map((item, index) => {
          const hasMatch = item.saavnBest !== null;

          return {
            spotify: {
              name: item.spotify.name,
              artists: item.spotify.artists,
              album: item.spotify.album,
              durationMs: item.spotify.durationMs,
              duration: item.spotify.duration,
              id: item.spotify.id,
              url: item.spotify.url,
              scrollPosition: index,
            },
            query: item.query,
            attempts: 1,
            candidatesConsidered: item.candidatesConsidered,
            match: hasMatch ? item.saavnBest : null, // Raw Saavn API response
            score: item.score,
            status: hasMatch ? 'matched' : 'noMatch',
          };
        });

        // Final result
        const result: PlaylistMappingResult = {
          source: {
            playlistId: playlistData.playlistId,
            name: playlistData.playlistName || 'Unknown Playlist',
            trackCount: playlistData.trackCount,
          },
          generatedAt: new Date().toISOString(),
          params: {
            limit: mappingOptions.limit || processed,
            minScore: 0.55,
          },
          summary: {
            processed,
            matched,
            lowConfidence: 0,
            noMatch,
          },
          items: transformedItems,
        };

        // Complete the job
        job.status = 'completed';
        job.progress = 100;
        job.result = result;
        job.completedAt = new Date();

        if (options.debug) {
          console.log(`[Queue] Completed job ${jobId}: ${matched}/${processed} tracks matched`);
        }

        this.emit('completed', job);
      } catch (error) {
        console.error(`[Queue] Error processing job ${jobId}:`, error);

        job.status = 'failed';
        job.error = error.message;
        job.completedAt = new Date();

        this.emit('failed', job, error);
      } finally {
        this.activeJobs.delete(jobId);
      }
    }

    this.isProcessing = false;
  }

  private updateProgress(jobId: string, progress: number) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = progress;
    }
  }

  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getStats() {
    const waiting = this.waitingJobs.length;
    const active = this.activeJobs.size;
    const completed = Array.from(this.jobs.values()).filter((j) => j.status === 'completed').length;
    const failed = Array.from(this.jobs.values()).filter((j) => j.status === 'failed').length;

    return { waiting, active, completed, failed };
  }

  // Clean up old jobs (keep last 50 jobs)
  cleanup() {
    const allJobs = Array.from(this.jobs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    if (allJobs.length > 50) {
      const toRemove = allJobs.slice(50);
      toRemove.forEach((job) => {
        if (job.status === 'completed' || job.status === 'failed') {
          this.jobs.delete(job.id);
        }
      });
    }
  }
}

// Create singleton queue instance
const playlistMappingQueue = new InMemoryQueue();

// Event handlers
playlistMappingQueue.on('completed', (job) => {
  console.log(`[Queue] Job ${job.id} completed successfully`);
});

playlistMappingQueue.on('failed', (job, error) => {
  console.error(`[Queue] Job ${job.id} failed:`, error.message);
});

// Cleanup old jobs every 30 minutes
setInterval(
  () => {
    playlistMappingQueue.cleanup();
  },
  30 * 60 * 1000,
);

// Function to add a mapping job to the queue
export const addPlaylistMappingJob = async (
  url: string,
  options: { fast?: boolean; debug?: boolean; limit?: number } = {},
  userId?: string,
): Promise<{ jobId: string; isExisting: boolean }> => {
  // Extract playlist ID from URL to use as job ID
  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    throw new Error('Invalid Spotify playlist URL');
  }

  const jobId = `playlist_${playlistId}`;

  const result = await playlistMappingQueue.addJob({
    jobId,
    url,
    options,
    userId,
  });

  return result;
};

// Function to get job status and result
export const getJobStatus = async (jobId: string) => {
  const job = playlistMappingQueue.getJob(jobId);

  if (!job) {
    return { status: 'not_found' };
  }

  if (job.status === 'completed') {
    return {
      status: 'completed',
      progress: 100,
      result: job.result,
      completedAt: job.completedAt,
    };
  } else if (job.status === 'failed') {
    return {
      status: 'failed',
      progress: job.progress,
      error: job.error,
      failedAt: job.completedAt,
    };
  } else if (job.status === 'active') {
    return {
      status: 'processing',
      progress: job.progress,
      startedAt: job.startedAt,
    };
  } else {
    return {
      status: 'waiting',
      progress: 0,
      queuedAt: job.createdAt,
    };
  }
};

// Function to get queue statistics
export const getQueueStats = async () => {
  return playlistMappingQueue.getStats();
};

export { playlistMappingQueue };
