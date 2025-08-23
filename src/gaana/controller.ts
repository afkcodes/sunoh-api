import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { fetchPost } from '../helpers/http';
import { radioDataMapper, radioDetailMapper } from './helper';

type GaanaRequest = FastifyRequest<{
  Querystring: {
    languages: string;
    language: string;
    page: number;
    count: number;
    name: string;
    stationId: string;
  };
  Params: {
    albumId: string;
    year: string;
    playlistId: string;
    mixId: string;
    radioId: string;
    trackId: string;
  };
}>;

const radioController = async (req: GaanaRequest, res: FastifyReply) => {
  const { page = 0 } = req.query;
  const { data, code, message, error } = await fetchPost(`${config.gaana.baseUrl}`, {
    params: {
      type: config.gaana.radio.popular,
      page: page,
    },
  });

  const sanitizedData = radioDataMapper(data, page);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const radioDetailController = async (req: GaanaRequest, res: FastifyReply) => {
  const { radioId } = req.params;
  console.log(radioId);
  const { data, code, message, error } = await fetchPost(`${config.gaana.baseUrl}`, {
    params: {
      type: config.gaana.radio.detail,
      id: radioId,
    },
  });

  const sanitizedData = await radioDetailMapper(data);
  res.code(code).send({ code, message, data: sanitizedData, error });
};

const trackController = async (req: GaanaRequest, res: FastifyReply) => {
  // const { trackId } = req.params;
  // const deviceId = '90fa4b38-4aaa-4612-89e6-517af208fee6';
  // const hashInput = `${trackId}|${deviceId}|03:40:31 sec`;
  // let hash = crypto.createHash('md5').update(hashInput).digest('hex');
  // hash += deviceId.slice(3, 9) + '=';
  // const { data, code, message, error } = await fetchPost(`${config.gaana.streamTrack}`, {
  //   formData: {
  //     track_id: trackId,
  //     quality: 'high',
  //     ht: hash,
  //     ps: deviceId,
  //     st: 'hls',
  //     request_type: 'web',
  //   },
  // });
  // res.code(code).send({ code, message, data: (data as any).stream_path, error });
  // fetch('https://gaana.com/api/stream-url', {
  //   headers: {
  //     accept: 'application/json, text/plain, */*',
  //     'accept-language': 'en-US,en;q=0.9',
  //     'content-type': 'application/x-www-form-urlencoded',
  //     'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
  //     'sec-ch-ua-mobile': '?0',
  //     'sec-ch-ua-platform': '"Linux"',
  //     'sec-fetch-dest': 'empty',
  //     'sec-fetch-mode': 'cors',
  //     'sec-fetch-site': 'same-origin',
  //     cookie:
  //       'deviceId=s%3A3f4c9082-5766-4130-8c41-59276f87a817.VVIqLu3JIu2KZRvR8j00oirzUO7es9HmjMV%2BwIPn5Qc; AMP_TOKEN=%24NOT_FOUND; _gid=GA1.2.187329475.1755781004; tc=light; ver=prod2232; __gads=ID=020a02b099a69161:T=1755781008:RT=1755781008:S=ALNI_MZfsO5pRTTP4rb0ymrzg6u1M9iDKw; __gpi=UID=00001183e265030c:T=1755781008:RT=1755781008:S=ALNI_MbjByztxvCE2jl2XeVZDNM5BByw5g; __eoi=ID=ff2783e6c3fc16ed:T=1755781008:RT=1755781008:S=AA-AfjbcCK0vxFMRnFridEwgZizx; _fbp=fb.1.1755781016538.705778340619274827; jsso_crosswalk_login_gaana.com=true; jsso_crosswalk_daily_gaana.com=true; captchaToken=; jsso_crosswalk_ssec_gaana.com=eeyYpVqrPes4__Q35ytDkNpeIcun1aTL-YzXEg0KEXk; csut=to6vBR7TZzAH/f/VZU3XXh4LhA93jsDoqn4ltpjZlgo=; gdpr={"flag":"1"}#{"flag":"1"}#{"flag":"1"}; _ga_GFL40X2T22=GS2.1.s1755781004$o1$g1$t1755781065$j60$l0$h1668924250; _ga=GA1.1.1210644366.1755781004; FCNEC=%5B%5B%22AKsRol8SVOgU7YOqqNBVfx_OGbImjSwjAB48CerqOlEoZTvqlvyznortCStjFUxxatJGnOBiCLCuZxKCvXPv7cjC8Ipd98QepjNfNUHyxoTk6C-IEYD3zUQX4kbMBpbL5TBoOQGQUVgjnNHIEyeM7Ebdvv9bXWaxFQ%3D%3D%22%5D%5D; __g_l=3; _gcl_au=1.1.609269467.1755781004.715064919.1755781042.1755781111; csrfToken=BAAGGuV1dLuBaiGJbi4QfIT6YVGoLH5RvDaHhRL4XKRmv4L/1B0yVEpMElWb58sQ; jsso_crosswalk_tksec_gaana.com=48yN4KaUC3t8c2cSKjOILm04eSp24lsr4Rf0e6fhwUlgCPGtra_wTg; __ul=Hindi%2CEnglish; wt=3caef75231d1e9f717c9fd2aa4ac4450; token=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2Vyb2JqIjp7IndlYlRva2VuIjoiM2NhZWY3NTIzMWQxZTlmNzE3YzlmZDJhYTRhYzQ0NTAiLCJnYWFuYXBsdXNfdXNlcl9zdGF0dXMiOnsiaXNfcmVuZXdhbCI6dHJ1ZSwiYWNjb3VudCI6InBhaWQiLCJ2YWxpZHVwdG8iOjE3NTkyMTAzMzQsInByb2R1Y3RfdHlwZSI6ImdhYW5hX3BsdXMiLCJwaWQiOiIxIn0sInNzb0lkIjoiM3FscTg3cGx0emQ5MDY4NHo2NGhjbHNwYSIsImlkIjoiMjE3NTQ4NjE2M1UiLCJ0aWNrZXRJZCI6IjQ5M2I1Y2FiZDI1YjRjZTJhNWJhYTMzMWI3ZGU3NWE3In0sImNzcmYiOiJCSVhqQ1hscTRsIiwiY3VzdG9tX3Nlc3MiOnt9LCJpYXQiOjE3NTU3ODExMzcsImV4cCI6MTc1NTc4MTczN30.seFZHYlLkVBTnj9ps1Mf0hM_cc9V0_qeVzr6UqQL6bM.VaVKYR1RHzTgTVgn7Va9qrDrD%2F5nOBf8dlflFbnhDDE; csrf=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2YWwiOiJCSVhqQ1hscTRsIiwiaWF0IjoxNzU1NzgxMTM3LCJleHAiOjE3NTU3ODE3Mzd9.5rIh9hXe0K40kZnF2MEtUwnmp01UI43GnGD6u2XRwhs.SdPpSQ76%2FFRo8kDfbppJwXJ%2FrdcqjAeTk%2Bw9L90Y%2BtI; reftoken=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2Vyb2JqIjp7IndlYlRva2VuIjoiM2NhZWY3NTIzMWQxZTlmNzE3YzlmZDJhYTRhYzQ0NTAiLCJnYWFuYXBsdXNfdXNlcl9zdGF0dXMiOnsiaXNfcmVuZXdhbCI6dHJ1ZSwiYWNjb3VudCI6InBhaWQiLCJ2YWxpZHVwdG8iOjE3NTkyMTAzMzQsInByb2R1Y3RfdHlwZSI6ImdhYW5hX3BsdXMiLCJwaWQiOiIxIn0sInNzb0lkIjoiM3FscTg3cGx0emQ5MDY4NHo2NGhjbHNwYSIsImlkIjoiMjE3NTQ4NjE2M1UiLCJ0aWNrZXRJZCI6IjQ5M2I1Y2FiZDI1YjRjZTJhNWJhYTMzMWI3ZGU3NWE3In0sImNzcmYiOiJCSVhqQ1hscTRsIiwiY3VzdG9tX3Nlc3MiOnt9LCJpYXQiOjE3NTU3ODExMzcsImV4cCI6MTc1ODM3MzEzN30._lVsrS_jorVhLhue6GzP_7Y-YtKOrU0zevBPaXoHQRQ.biWnM5BNKLHqH3uI7oqw5NTWkympDM3cgS5exa5dG0o; playerloaded=1; _gat=1',
  //     Referer: 'https://gaana.com/playlist/gaana-dj-hindi-90s-top-50',
  //   },
  //   body: 'quality=extreme&track_id=30222',
  //   method: 'POST',
  // })
  //   .then((response) => {
  //     if (!response.ok) {
  //       return res
  //         .code(500)
  //         .send({ code: 500, message: 'Failed to fetch track stream URL', error: true });
  //     }
  //     return response.json();
  //   })
  //   .then((data) => {
  //     console.log(data);
  //     res.code(200).send({ code: 200, message: 'Success', data: data, error: false });
  //   })
  //   .catch((err) => {
  //     res.code(500).send({ code: 500, message: err.message, error: true });
  //   });
};

export { radioController, radioDetailController, trackController };
