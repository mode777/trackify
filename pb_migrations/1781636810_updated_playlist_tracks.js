/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2773994383")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != '' && playlist.user = @request.auth.id",
    "deleteRule": "@request.auth.id != '' && playlist.user = @request.auth.id",
    "updateRule": "@request.auth.id != '' && playlist.user = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2773994383")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "updateRule": null
  }, collection)

  return app.save(collection)
})
