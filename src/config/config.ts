export const config = {
  saavn: {
    baseUrl: 'https://www.jiosaavn.com/api.php',
    _format: 'json',
    _marker: 0,
    api_version: '4',
    ctx: 'web6dot0',
    endpoint: {
      modules: {
        home: 'webapi.getLaunchData',
        browse_modules: 'content.getBrowseModules',
      },
      album: {
        id: 'content.getAlbumDetails',
        token: 'webapi.get',
        recommended: 'reco.getAlbumReco',
        top_albums_by_year: 'search.topAlbumsoftheYear',
      },
      song: {
        id: 'song.getDetails',
        link: 'webapi.get',
        recommended: 'reco.getreco',
      },

      playlist: {
        id: 'playlist.getDetails',
        token: 'webapi.get',
        recommended: 'reco.getPlaylistReco',
      },

      artist: {
        id: 'artist.getArtistPageDetails',
        link: 'webapi.get',
        songs: 'artist.getArtistMoreSong',
        albums: 'artist.getArtistMoreAlbum',
        top_songs: 'search.artistOtherTopSongs',
      },

      search: {
        top_search: 'content.getTopSearches',
        autocomplete: 'autocomplete.get',
        songs: 'search.getResults',
        albums: 'search.getAlbumResults',
        artists: 'search.getArtistResults',
        playlists: 'search.getPlaylistResults',
        more: 'search.getMoreResults',
      },

      radio: {
        featured: 'webradio.createFeaturedStation',
        artist: 'webradio.createArtistStation',
        entity: 'webradio.createEntityStation',
        songs: 'webradio.getSong',
      },

      show: {
        show_details: 'webapi.get',
        episodes: 'show.getAllEpisodes',
        episode_details: 'webapi.get',
      },

      get: {
        trending: 'content.getTrending',
        featured_playlists: 'content.getFeaturedPlaylists',
        charts: 'content.getCharts',
        top_shows: 'content.getTopShows',
        top_artists: 'social.getTopArtists',
        top_albums: 'content.getAlbums',
        mix_details: 'webapi.get',
        label_details: 'webapi.get',
        featured_stations: 'webradio.getFeaturedStations',
        actor_top_songs: 'search.actorOtherTopSongs',
        lyrics: 'lyrics.getLyrics',
        footer_details: 'webapi.getFooterDetails',
        mega_menu: 'webapi.getBrowseHoverDetails',
      },
    },
  },

  gaana: {
    baseUrl: 'https://gaana.com/apiv2',
    streamTrack: 'https://apiv2.gaana.com/track/stream',
    radio: {
      popular: 'radioPopular',
      mood: 'radioMood',
      artist: 'radioArtist',
      latest: 'radioLatest',
      detail: 'gaanaradiodetail',
    },
  },
};
