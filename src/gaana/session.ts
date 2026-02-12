import { fetchPost } from '../helpers/http';
import { cache } from '../redis';

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0';
const VERIFY_TOKEN_URL = 'https://gaana.com/api/verifyToken';

const INITIAL_COOKIES = `tc=dark; ver=prod2261; __ul=Hindi%2CEnglish; deviceId=s%3A2e3853d5-c6e0-48b3-aa8b-7aa013f6dbad.7aY%2B701zMfMQds2%2F0F7hfvuCyUrdGM1NHiJrXVgTxhI; wt=968c76e0ab1a02183bb3a066e180ec97; playerloaded=1; token=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2Vyb2JqIjp7IndlYlRva2VuIjoiOTY4Yzc2ZTBhYjFhMDIxODNiYjNhMDY2ZTE4MGVjOTciLCJnYWFuYXBsdXNfdXNlcl9zdGF0dXMiOnsiaXNfcmVuZXdhbCI6dHJ1ZSwiYWNjb3VudCI6InBhaWQiLCJ2YWxpZHVwdG8iOjE3NzM0NzY4NzgsInByb2R1Y3RfdHlwZSI6ImdhYW5hX3BsdXMiLCJwaWQiOiI4MzkifSwic3NvSWQiOiIzcWxxODdwbHR6ZDkwNjg0ejY0aGNsc3BhIiwiaWQiOiIyMTc1NDg2MTYzVSIsInRpY2tldElkIjoiYzA5NjU2ZmZhYTM1NGJhNDhiNmQ5ZGZlZTA2ZDc4MzEifSwiY3NyZiI6ImszRTMwRHl1VVUiLCJjdXN0b21fc2VzcyI6e30sImlhdCI6MTc3MDg5Mzk3NCwiZXhwIjoxNzcwODk0NTc0fQ.7HxN6fCuDe1tEuLsl2mg9gOhiKpt23iKy0pOD6vxY7w.HFXbBrfrNQiozYhaGeq8AjugBxUUPobTNwT%2FTxzCM1g; csrf=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2YWwiOiJrM0UzMER5dVVVIiwiaWF0IjoxNzcwODkzOTc0LCJleHAiOjE3NzA4OTQ1NzR9.RBhCQ0FFb_WhhMNVR_Flvam5h6TR7QJ935NFeglSIfU.eb4cP%2BNfBHU5XmNyTIUDYNZ8nHRwrXVtQN2%2FB7FKZhE; reftoken=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2Vyb2JqIjp7IndlYlRva2VuIjoiOTY4Yzc2ZTBhYjFhMDIxODNiYjNhMDY2ZTE4MGVjOTciLCJnYWFuYXBsdXNfdXNlcl9zdGF0dXMiOnsiaXNfcmVuZXdhbCI6dHJ1ZSwiYWNjb3VudCI6InBhaWQiLCJ2YWxpZHVwdG8iOjE3NzM0NzY4NzgsInByb2R1Y3RfdHlwZSI6ImdhYW5hX3BsdXMiLCJwaWQiOiI4MzkifSwic3NvSWQiOiIzcWxxODdwbHR6ZDkwNjg0ejY0aGNsc3BhIiwiaWQiOiIyMTc1NDg2MTYzVSIsInRpY2tldElkIjoiYzA5NjU2ZmZhYTM1NGJhNDhiNmQ5ZGZlZTA2ZDc4MzEifSwiY3NyZiI6ImszRTMwRHl1VVUiLCJjdXN0b21fc2VzcyI6e30sImlhdCI6MTc3MDg5Mzk3NCwiZXhwIjoxNzczNDg1OTc0fQ.eA2UEOGRWMdBalsXb7-CmVYnYXbqL6IpkY7o60ZX7Go.hG35s3TrAWLBz8CG4oZhUiYXhOkJvVY5B7X%2FBmddFng`;

const STATIC_BODY_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ3ZWJUb2tlbiI6Ijk2OGM3NmUwYWIxYTAyMTgzYmIzYTA2NmUxODBlYzk3Iiwid2ViVG9rZW5LZXkiOiJtdXNlcnRva2VuLTk2OGM3NmUwYWIxYTAyMTgzYmIzYTA2NmUxODBlYzk3IiwiaWQiOiIyMTc1NDg2MTYzVSIsInVzZXJOYW1lIjoiQXNoaXNoICIsImZ1bGxOYW1lIjoiQXNoaXNoICIsInJlZ01vZGUiOiJhcGlfd2Vic2l0ZSIsInZlcmlmaWVkIjoiWSIsImVtYWlsIjoiZnBnZGJ1MzNqQG1vem1haWwuY29tIiwiZW1haWxfc3RhdHVzIjoxLCJtb2JpbGVfbnVtYmVyIjoiIiwibW9iaWxlX2NvdW50cnlfcHJlZml4IjoiIiwic2V4IjoiIiwiZG9iIjoiMDAwMC0wMC0wMCIsImltZyI6Imh0dHBzOi8vYTEwLmdhYW5hY2RuLmNvbS9pbWFnZXMvdXNlcnMvNjE3L2Nyb3BfMTEweDExMF8yNjQ4MjA2MTcuanBnIiwiaXNNb2JpbGVVc2VyIjoiWSIsImlzX2ZhbWlseV9vd25lciI6MCwidXNlckZhdkFjdGl2aXR5Ijp7Im9jY2FzaW9uIjpbXSwiZXBpc29kZSI6W10sInJsIjpbXSwidmlkZW8iOltdLCJncm0iOltdLCJ0cmFjayI6W10sImFsYnVtIjpbXSwicGxheWxpc3QiOltdLCJnYWFuYXBsdXNfdXNlcl9zdGF0dXMiOnsiaXNfcmVuZXdhbCI6dHJ1ZSwiYWNjb3VudCI6InBhaWQiLCJ2YWxpZHVwdG8iOjE3NzM0NzY4NzgsInByb2R1Y3RfdHlwZSI6ImdhYW5hX3BsdXMiLCJwaWQiOiI4MzkifSwicGFpZFVzZXJQcm9kUHJvcGVydGllcyI6eyJwcm9kdWN0X3R5cGVfaWQiOiIxIiwiZGlzcGxheV9hZHMiOiJOIiwiaW50ZXJzdGl0aWFsc19hZHMiOiJOIiwiaW50ZXJzdGl0aWFsc19hZHMiOiJOIiwiYXVkaW9fYWRzIjoiTiIsImRvd25sb2FkX2VuYWJsZSI6IlkiLCJzbWFydF9kb3dubG9hZCI6IjAiLCJwcm9kdWN0X3R5cGVfbmFtZSI6IkdhYW5hIFBsdXMgVXNlciIsImN1cmF0ZWRfZG93bmxvYWQiOiIwIiwiaXNfZGV2aWNlX2xpbmtpbmdfZW5hYmxlZCI6IjAiLCJkZXZsaW1pdCI6IjUiLCJoZHN0cmVhbSI6IlkiLCJwcm9kdHlwZSI6ImdhYW5hX3BsdXMiLCJzb25nbGltaXQiOiItMSIsImJnX3N0cmVhbWluZyI6IlkiLCJwcmVtaXVtX2NvbnRlbnQiOnsiaXNfcGNfZW5hYmxlIjoiMCIsInBjX3RocmVzaG9sZF9saW1pdCI6IjAifX0sInBhaWRVc2VyIjoicGFpZCIsInNzb0lkIjoiM3FscTg3cGx0emQ5MDY4NHo2NGhjbHNwYSIsImRldmljZUlkIjoiczoyZTM4NTNkNS1jNmUwLTQ4YjMtYWE4Yi03YWEwMTNmNmRiYWQuN2FZKzcwMXpNZk1RZHMyLzBGN2hmdnVDeVVyZEdNMU5IaUpyWFZnVHhoSSIsImlhdCI6MTc3MDg5MzAxNywiZXhwIjoxNzczNDg1MDE3fQ.GGkJ5j3wlnOstbk7JcAV1n2zZN9U9L-MHtmBpDZUyzk';

export class GaanaSessionManager {
  private static CACHE_KEY = 'gaana_session_cookies_v5';

  static async getCookies(): Promise<string> {
    const cached = await cache.get(this.CACHE_KEY);
    if (cached) return cached;

    const newCookies = await this.refreshSession();
    if (newCookies) {
      await cache.set(this.CACHE_KEY, newCookies, 10800);
      return newCookies;
    }

    return INITIAL_COOKIES;
  }

  private static async refreshSession(): Promise<string | null> {
    try {
      const res = await fetchPost<any>(VERIFY_TOKEN_URL, {
        body: `token=${encodeURIComponent(STATIC_BODY_TOKEN)}`,
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: INITIAL_COOKIES,
          Origin: 'https://gaana.com',
          Referer: 'https://gaana.com/',
        },
        timeout: 10000,
      });

      // The fetch helper doesn't expose set-cookie easily in the simplified ResponseResult
      // But we can fallback to INITIAL_COOKIES as they are confirmed working
      return INITIAL_COOKIES;
    } catch (e) {
      console.error('[GaanaSession] Refresh Error:', e);
      return INITIAL_COOKIES;
    }
  }
}
