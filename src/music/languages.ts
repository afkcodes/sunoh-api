import { FastifyReply, FastifyRequest } from 'fastify';
import { sendSuccess } from '../utils/response';

export const getLanguages = async (req: FastifyRequest, res: FastifyReply) => {
  const languages = [
    { name: 'Hindi', value: 'hindi' },
    { name: 'English', value: 'english' },
    { name: 'Punjabi', value: 'punjabi' },
    { name: 'Telugu', value: 'telugu' },
    { name: 'Tamil', value: 'tamil' },
    { name: 'Bhojpuri', value: 'bhojpuri' },
    { name: 'Bengali', value: 'bengali' },
    { name: 'Malayalam', value: 'malayalam' },
    { name: 'Kannada', value: 'kannada' },
    { name: 'Marathi', value: 'marathi' },
    { name: 'Gujarati', value: 'gujarati' },
    { name: 'Haryanvi', value: 'haryanvi' },
    { name: 'Urdu', value: 'urdu' },
    { name: 'Assamese', value: 'assamese' },
    { name: 'Rajasthani', value: 'rajasthani' },
    { name: 'Odia', value: 'odia' },
    { name: 'Sanskrit', value: 'sanskrit' },
  ];

  return sendSuccess(res, languages, 'Languages fetched successfully');
};
