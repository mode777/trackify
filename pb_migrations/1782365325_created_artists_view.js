/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
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
        "help": "",
        "hidden": false,
        "id": "json22648455",
        "maxSize": 1,
        "name": "artist",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      }
    ],
    "id": "pbc_1402384472",
    "indexes": [],
    "listRule": null,
    "name": "artists_view",
    "system": false,
    "type": "view",
    "updateRule": null,
    "viewQuery": "SELECT\n  (ROW_NUMBER() OVER (ORDER BY ua.artist)) as id,\n  ua.artist as artist\nFROM (\n  SELECT DISTINCT\n    j.value as artist\n  FROM tracks t\n  JOIN json_each(t.artist) j\n  WHERE json_valid(t.artist)\n    AND j.type = 'text'\n) ua\nORDER BY ua.artist",
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1402384472");

  return app.delete(collection);
})
