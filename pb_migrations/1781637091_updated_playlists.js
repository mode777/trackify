/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2546747700")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "deleteRule": "@request.auth.id != '' && @request.auth.id = user.id",
    "listRule": "type = 'public' || (@request.auth.id != '' && @request.auth.id = user.id)",
    "updateRule": "@request.auth.id != '' && @request.auth.id = user.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2546747700")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": null,
    "updateRule": null
  }, collection)

  return app.save(collection)
})
