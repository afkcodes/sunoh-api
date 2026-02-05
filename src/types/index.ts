export interface Image {
  quality: string;
  link: string;
}

export type Images = Image[];

export interface Artist {
  id: string;
  name: string;
  subtitle?: string;
  role?: string;
  image?: Images;
  followers?: string;
  type?: string;
  url?: string;
  bio?: string;
  songCount?: string;
  albumCount?: string;
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
  description?: string;
  type: 'album';
  image: Images;
  language?: string;
  year?: string;
  songCount?: string;
  artists: Artist[];
  songs?: Song[];
  copyright?: string;
  releaseDate?: string;
  playCount?: string;
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

export interface Occasion {
  id: string;
  title: string;
  subtitle?: string;
  type: 'occasion';
  image: Images;
  source: string;
  url?: string;
}

export interface HomeSection {
  heading: string;
  data: (Song | Album | Playlist | Artist | Channel | Occasion)[];
  source: string;
}

export type HomeData = HomeSection[];
