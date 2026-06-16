/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3634167119");

  return app.delete(collection);
}, (app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "_clone_Xfph",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "user",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
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
        "id": "_clone_UX8I",
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
        "id": "_clone_Mk56",
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
        "id": "_clone_EtXr",
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
        "id": "_clone_Gt7j",
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
        "id": "_clone_9bAP",
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
        "id": "_clone_mvb3",
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
        "id": "_clone_GJ5d",
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
        "id": "_clone_GST3",
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
        "id": "_clone_kyr8",
        "maxSize": 0,
        "name": "company",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }
    ],
    "id": "pbc_3634167119",
    "indexes": [],
    "listRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "name": "favorites_view",
    "system": false,
    "type": "view",
    "updateRule": null,
    "viewQuery": "SELECT favorites.user, tracks.id, tracks.title, games.coverArt, games.title as game, tracks.gameId, games.year, tracks.filename, tracks.length, games.platform, games.company \nFROM favorites\nLEFT JOIN tracks on favorites.track = tracks.id \nLEFT JOIN games on tracks.gameId = games.id \n\n\n",
    "viewRule": null
  });

  return app.save(collection);
})
