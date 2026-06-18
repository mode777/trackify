/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_798425803")

  // update collection data
  unmarshal({
    "viewQuery": "SELECT tracks.id, tracks.title, games.coverArt, games.title as game, tracks.gameId, games.year, tracks.filename, tracks.length, games.platform, games.company, tracks.artist from\ntracks LEFT JOIN games on tracks.gameId = games.id \norder by tracks.id"
  }, collection)

  // remove field
  collection.fields.removeById("_clone_2hdE")

  // remove field
  collection.fields.removeById("_clone_zlsX")

  // remove field
  collection.fields.removeById("_clone_Ugk5")

  // remove field
  collection.fields.removeById("_clone_Miyj")

  // remove field
  collection.fields.removeById("_clone_nFUd")

  // remove field
  collection.fields.removeById("_clone_kjGO")

  // remove field
  collection.fields.removeById("_clone_E7Qs")

  // remove field
  collection.fields.removeById("_clone_XdPK")

  // remove field
  collection.fields.removeById("_clone_GNDX")

  // add field
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_uc0H",
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
  collection.fields.addAt(2, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_MNjk",
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
  collection.fields.addAt(3, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_6xDI",
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
  collection.fields.addAt(4, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_879072730",
    "help": "",
    "hidden": false,
    "id": "_clone_i6Ew",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "gameId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_3p8b",
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
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_vXUg",
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
  collection.fields.addAt(7, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_XprB",
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
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_Rc2Z",
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
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_TSwB",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_CJqx",
    "maxSize": 0,
    "name": "artist",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_798425803")

  // update collection data
  unmarshal({
    "viewQuery": "SELECT tracks.id, tracks.title, games.coverArt, games.title as game, tracks.gameId, games.year, tracks.filename, tracks.length, games.platform, games.company from\ntracks LEFT JOIN games on tracks.gameId = games.id \norder by tracks.id"
  }, collection)

  // add field
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_2hdE",
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
  collection.fields.addAt(2, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_zlsX",
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
  collection.fields.addAt(3, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_Ugk5",
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
  collection.fields.addAt(4, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_879072730",
    "help": "",
    "hidden": false,
    "id": "_clone_Miyj",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "gameId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_nFUd",
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
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_kjGO",
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
  collection.fields.addAt(7, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_E7Qs",
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
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_XdPK",
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
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_GNDX",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // remove field
  collection.fields.removeById("_clone_uc0H")

  // remove field
  collection.fields.removeById("_clone_MNjk")

  // remove field
  collection.fields.removeById("_clone_6xDI")

  // remove field
  collection.fields.removeById("_clone_i6Ew")

  // remove field
  collection.fields.removeById("_clone_3p8b")

  // remove field
  collection.fields.removeById("_clone_vXUg")

  // remove field
  collection.fields.removeById("_clone_XprB")

  // remove field
  collection.fields.removeById("_clone_Rc2Z")

  // remove field
  collection.fields.removeById("_clone_TSwB")

  // remove field
  collection.fields.removeById("_clone_CJqx")

  return app.save(collection)
})
