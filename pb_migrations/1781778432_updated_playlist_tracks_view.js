/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3914548316")

  // update collection data
  unmarshal({
    "viewQuery": "SELECT playlist_tracks.id as playlistTrackId, playlists.id as playlistId, users.id as userId, playlists.type, tracks.id, tracks.title, games.coverArt, games.title as game, tracks.gameId, games.year, tracks.filename, tracks.length, games.platform, games.company, tracks.artist \nfrom playlist_tracks\nLEFT JOIN playlists on playlist_tracks.playlist = playlists.id\nLEFT JOIN users on users.id = playlists.user\nLEFT JOIN tracks on playlist_tracks.track = tracks.id\nLEFT JOIN games on tracks.gameId = games.id "
  }, collection)

  // remove field
  collection.fields.removeById("_clone_FZjH")

  // remove field
  collection.fields.removeById("_clone_G1lS")

  // remove field
  collection.fields.removeById("_clone_hV0k")

  // remove field
  collection.fields.removeById("_clone_Coh7")

  // remove field
  collection.fields.removeById("_clone_lRgZ")

  // remove field
  collection.fields.removeById("_clone_jKjw")

  // remove field
  collection.fields.removeById("_clone_zE68")

  // remove field
  collection.fields.removeById("_clone_OUdY")

  // remove field
  collection.fields.removeById("_clone_hbBb")

  // remove field
  collection.fields.removeById("_clone_h5FH")

  // add field
  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_Virh",
    "maxSelect": 0,
    "name": "type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "private",
      "public",
      "favorites"
    ]
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_CU7p",
    "max": 0,
    "min": 0,
    "name": "title",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_felU",
    "maxSelect": 0,
    "maxSize": 0,
    "mimeTypes": null,
    "name": "coverArt",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_4I2L",
    "max": 0,
    "min": 0,
    "name": "game",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_879072730",
    "help": "",
    "hidden": false,
    "id": "_clone_tNHK",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "gameId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_Zj3e",
    "max": 0,
    "min": 0,
    "name": "year",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_YwhJ",
    "max": 0,
    "min": 0,
    "name": "filename",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_Z24z",
    "max": null,
    "min": null,
    "name": "length",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_Ywjs",
    "maxSelect": 0,
    "name": "platform",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "psx",
      "snes",
      "megadrive",
      "n64",
      "assorted",
      "ps2"
    ]
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_Qlh9",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_5Kpc",
    "maxSize": 0,
    "name": "artist",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3914548316")

  // update collection data
  unmarshal({
    "viewQuery": "SELECT playlist_tracks.id as playlistTrackId, playlists.id as playlistId, users.id as userId, playlists.type, tracks.id, tracks.title, games.coverArt, games.title as game, tracks.gameId, games.year, tracks.filename, tracks.length, games.platform, games.company \nfrom playlist_tracks\nLEFT JOIN playlists on playlist_tracks.playlist = playlists.id\nLEFT JOIN users on users.id = playlists.user\nLEFT JOIN tracks on playlist_tracks.track = tracks.id\nLEFT JOIN games on tracks.gameId = games.id "
  }, collection)

  // add field
  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_FZjH",
    "maxSelect": 0,
    "name": "type",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "private",
      "public",
      "favorites"
    ]
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_G1lS",
    "max": 0,
    "min": 0,
    "name": "title",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_hV0k",
    "maxSelect": 0,
    "maxSize": 0,
    "mimeTypes": null,
    "name": "coverArt",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_Coh7",
    "max": 0,
    "min": 0,
    "name": "game",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_879072730",
    "help": "",
    "hidden": false,
    "id": "_clone_lRgZ",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "gameId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_jKjw",
    "max": 0,
    "min": 0,
    "name": "year",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_zE68",
    "max": 0,
    "min": 0,
    "name": "filename",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_OUdY",
    "max": null,
    "min": null,
    "name": "length",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_hbBb",
    "maxSelect": 0,
    "name": "platform",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "psx",
      "snes",
      "megadrive",
      "n64",
      "assorted",
      "ps2"
    ]
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_h5FH",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // remove field
  collection.fields.removeById("_clone_Virh")

  // remove field
  collection.fields.removeById("_clone_CU7p")

  // remove field
  collection.fields.removeById("_clone_felU")

  // remove field
  collection.fields.removeById("_clone_4I2L")

  // remove field
  collection.fields.removeById("_clone_tNHK")

  // remove field
  collection.fields.removeById("_clone_Zj3e")

  // remove field
  collection.fields.removeById("_clone_YwhJ")

  // remove field
  collection.fields.removeById("_clone_Z24z")

  // remove field
  collection.fields.removeById("_clone_Ywjs")

  // remove field
  collection.fields.removeById("_clone_Qlh9")

  // remove field
  collection.fields.removeById("_clone_5Kpc")

  return app.save(collection)
})
