/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3634167119")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id != '' && @request.auth.id = user.id"
  }, collection)

  // remove field
  collection.fields.removeById("_clone_bqQE")

  // remove field
  collection.fields.removeById("_clone_JncV")

  // remove field
  collection.fields.removeById("_clone_sHPX")

  // remove field
  collection.fields.removeById("_clone_mjdu")

  // remove field
  collection.fields.removeById("_clone_r4cf")

  // remove field
  collection.fields.removeById("_clone_omyB")

  // remove field
  collection.fields.removeById("_clone_0Huz")

  // remove field
  collection.fields.removeById("_clone_05Oy")

  // remove field
  collection.fields.removeById("_clone_qQqD")

  // remove field
  collection.fields.removeById("_clone_wJEJ")

  // add field
  collection.fields.addAt(0, new Field({
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
  }))

  // add field
  collection.fields.addAt(2, new Field({
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
  }))

  // add field
  collection.fields.addAt(3, new Field({
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
  }))

  // add field
  collection.fields.addAt(4, new Field({
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
  }))

  // add field
  collection.fields.addAt(5, new Field({
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
  }))

  // add field
  collection.fields.addAt(6, new Field({
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
  }))

  // add field
  collection.fields.addAt(7, new Field({
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
  }))

  // add field
  collection.fields.addAt(8, new Field({
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
  }))

  // add field
  collection.fields.addAt(9, new Field({
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
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_kyr8",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3634167119")

  // update collection data
  unmarshal({
    "listRule": null
  }, collection)

  // add field
  collection.fields.addAt(0, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "help": "",
    "hidden": false,
    "id": "_clone_bqQE",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "user",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(2, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_JncV",
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
  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_sHPX",
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
  collection.fields.addAt(4, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_mjdu",
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
  collection.fields.addAt(5, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_879072730",
    "help": "",
    "hidden": false,
    "id": "_clone_r4cf",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "gameId",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_omyB",
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
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "_clone_0Huz",
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
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_05Oy",
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
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_qQqD",
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
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "_clone_wJEJ",
    "maxSize": 0,
    "name": "company",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // remove field
  collection.fields.removeById("_clone_Xfph")

  // remove field
  collection.fields.removeById("_clone_UX8I")

  // remove field
  collection.fields.removeById("_clone_Mk56")

  // remove field
  collection.fields.removeById("_clone_EtXr")

  // remove field
  collection.fields.removeById("_clone_Gt7j")

  // remove field
  collection.fields.removeById("_clone_9bAP")

  // remove field
  collection.fields.removeById("_clone_mvb3")

  // remove field
  collection.fields.removeById("_clone_GJ5d")

  // remove field
  collection.fields.removeById("_clone_GST3")

  // remove field
  collection.fields.removeById("_clone_kyr8")

  return app.save(collection)
})
