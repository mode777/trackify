/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2151843437");

  return app.delete(collection);
}, (app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "deleteRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "help": "",
        "hidden": false,
        "id": "relation2375276105",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "user",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_327047008",
        "help": "",
        "hidden": false,
        "id": "relation3605264550",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "track",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_2546747700",
        "help": "",
        "hidden": false,
        "id": "relation1653163849",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "relation",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_2151843437",
    "indexes": [],
    "listRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "name": "favorites",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "viewRule": null
  });

  return app.save(collection);
})
