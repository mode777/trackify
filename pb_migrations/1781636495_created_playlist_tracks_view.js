/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "cascadeDelete": false,
        "collectionId": "pbc_2546747700",
        "help": "",
        "hidden": false,
        "id": "relation1613229677",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "playlistId",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation1689669068",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "userId",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "help": "",
        "hidden": false,
        "id": "_clone_Z3n4",
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
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 0,
        "min": 0,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "_clone_lqIM",
        "max": 0,
        "min": 0,
        "name": "title",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "_clone_38WB",
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
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "_clone_HZhp",
        "max": 0,
        "min": 0,
        "name": "game",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "pbc_879072730",
        "help": "",
        "hidden": false,
        "id": "_clone_8dJA",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "gameId",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "_clone_d3D5",
        "max": 0,
        "min": 0,
        "name": "year",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "_clone_FM1P",
        "max": 0,
        "min": 0,
        "name": "filename",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "_clone_l29W",
        "max": null,
        "min": null,
        "name": "length",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "help": "",
        "hidden": false,
        "id": "_clone_IkGV",
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
      },
      {
        "help": "",
        "hidden": false,
        "id": "_clone_fBOi",
        "maxSize": 0,
        "name": "company",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }
    ],
    "id": "pbc_3914548316",
    "indexes": [],
    "listRule": "type = 'public' || (@request.auth.id = userId)",
    "name": "playlist_tracks_view",
    "system": false,
    "type": "view",
    "updateRule": null,
    "viewQuery": "SELECT playlists.id as playlistId, users.id as userId, playlists.type, tracks.id, tracks.title, games.coverArt, games.title as game, tracks.gameId, games.year, tracks.filename, tracks.length, games.platform, games.company \nfrom playlist_tracks\nLEFT JOIN playlists on playlist_tracks.playlist = playlists.id\nLEFT JOIN users on users.id = playlists.user\nLEFT JOIN tracks on playlist_tracks.track = tracks.id\nLEFT JOIN games on tracks.gameId = games.id ",
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3914548316");

  return app.delete(collection);
})
