/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_798425803")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id != '' && @request.auth.id = gameId.favorites_view_via_gameId.user",
    "viewRule": null
  }, collection)

  // remove field
  collection.fields.removeById("_clone_9GT1")

  // remove field
  collection.fields.removeById("_clone_HnGu")

  // remove field
  collection.fields.removeById("_clone_uY83")

  // remove field
  collection.fields.removeById("_clone_oOIa")

  // remove field
  collection.fields.removeById("_clone_gLSm")

  // remove field
  collection.fields.removeById("_clone_vQjB")

  // remove field
  collection.fields.removeById("_clone_SMVV")

  // remove field
  collection.fields.removeById("_clone_9mc7")

  // remove field
  collection.fields.removeById("_clone_Yngj")

  // add field
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_MuYK",
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
    "id": "_clone_CBs7",
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
    "id": "_clone_rRfw",
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
    "id": "_clone_1VNv",
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
    "id": "_clone_8KAB",
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
    "id": "_clone_BtG3",
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
    "id": "_clone_zI3j",
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
    "id": "_clone_zHMN",
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
    "id": "_clone_nOlB",
    "maxSize": 0,
    "name": "company",
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
    "listRule": "",
    "viewRule": ""
  }, collection)

  // add field
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_9GT1",
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
    "id": "_clone_HnGu",
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
    "id": "_clone_uY83",
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
    "id": "_clone_oOIa",
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
    "id": "_clone_gLSm",
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
    "id": "_clone_vQjB",
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
    "id": "_clone_SMVV",
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
    "id": "_clone_9mc7",
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
    "id": "_clone_Yngj",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // remove field
  collection.fields.removeById("_clone_MuYK")

  // remove field
  collection.fields.removeById("_clone_CBs7")

  // remove field
  collection.fields.removeById("_clone_rRfw")

  // remove field
  collection.fields.removeById("_clone_1VNv")

  // remove field
  collection.fields.removeById("_clone_8KAB")

  // remove field
  collection.fields.removeById("_clone_BtG3")

  // remove field
  collection.fields.removeById("_clone_zI3j")

  // remove field
  collection.fields.removeById("_clone_zHMN")

  // remove field
  collection.fields.removeById("_clone_nOlB")

  return app.save(collection)
})
