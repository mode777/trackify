/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_879072730")

  // update field
  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "file104153177",
    "maxSelect": 0,
    "maxSize": 500000,
    "mimeTypes": null,
    "name": "files",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_879072730")

  // update field
  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "file104153177",
    "maxSelect": 0,
    "maxSize": 0,
    "mimeTypes": null,
    "name": "files",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
})
