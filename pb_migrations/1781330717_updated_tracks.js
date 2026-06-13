/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_327047008")

  // remove field
  collection.fields.removeById("file2359244304")

  // add field
  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1007413605",
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

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_327047008")

  // add field
  collection.fields.addAt(4, new Field({
    "help": "",
    "hidden": false,
    "id": "file2359244304",
    "maxSelect": 0,
    "maxSize": 52428800,
    "mimeTypes": [],
    "name": "file",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  // remove field
  collection.fields.removeById("text1007413605")

  return app.save(collection)
})
