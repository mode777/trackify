/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1402384472")

  // update collection data
  unmarshal({
    "viewQuery": "SELECT\n  (ROW_NUMBER() OVER (ORDER BY ua.title)) as id,\n  ua.title as title\nFROM (\n  SELECT DISTINCT\n    j.value as title\n  FROM tracks t\n  JOIN json_each(t.artist) j\n  WHERE json_valid(t.artist)\n    AND j.type = 'text'\n) ua\nORDER BY ua.title"
  }, collection)

  // remove field
  collection.fields.removeById("json22648455")

  // add field
  collection.fields.addAt(1, new Field({
    "help": "",
    "hidden": false,
    "id": "json724990059",
    "maxSize": 1,
    "name": "title",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1402384472")

  // update collection data
  unmarshal({
    "viewQuery": "SELECT\n  (ROW_NUMBER() OVER (ORDER BY ua.artist)) as id,\n  ua.artist as artist\nFROM (\n  SELECT DISTINCT\n    j.value as artist\n  FROM tracks t\n  JOIN json_each(t.artist) j\n  WHERE json_valid(t.artist)\n    AND j.type = 'text'\n) ua\nORDER BY ua.artist"
  }, collection)

  // add field
  collection.fields.addAt(1, new Field({
    "help": "",
    "hidden": false,
    "id": "json22648455",
    "maxSize": 1,
    "name": "artist",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // remove field
  collection.fields.removeById("json724990059")

  return app.save(collection)
})
