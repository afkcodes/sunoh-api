export interface Image {
  quality: string;
  link: string;
}

export type Images = Image[];

export interface Artist {
  id: string;
  name: string;
  role?: string;
  image?: Images;
  type?: string;
  url?: string;
}

export interface Song {
  id: string;
  title: string;
  subtitle?: string;
  type: 'song';
  image: Images;
  language?: string;
  year?: string;
  duration?: string;
  playCount?: string;
  mediaUrls?: Images;
  artists: Artist[];
  album?: {
    id: string;
    name: string;
    url?: string;
  };
  hasLyrics?: boolean;
  lyrics?: string;
  copyright?: string;
  releaseDate?: string;
  source: string;
}

export interface Album {
  id: string;
  title: string;
  subtitle?: string;
  headerDesc?: string;
  type: 'album';
  image: Images;
  language?: string;
  year?: string;
  songCount?: string;
  artists: Artist[];
  songs?: Song[];
  source: string;
  url?: string;
}

export interface Playlist {
  id: string;
  title: string;
  subtitle?: string;
  type: 'playlist';
  image: Images;
  songCount?: string;
  followers?: string;
  description?: string;
  songs?: Song[];
  source: string;
  url?: string;
}

export interface Channel {
  id: string;
  title: string;
  subtitle?: string;
  type: 'channel';
  image: Images;
  source: string;
  url?: string;
}

export interface HomeSection {
  heading: string;
  data: (Song | Album | Playlist | Artist | Channel)[];
  source: string;
}

export type HomeData = HomeSection[];
