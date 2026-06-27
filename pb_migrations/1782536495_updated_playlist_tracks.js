/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2773994383")

  // update collection data
  unmarshal({
    "listRule": "playlist.type = 'public' || (playlist.user.id = @request.auth.id)",
    "viewRule": "playlist.type = 'public' || (playlist.user.id = @request.auth.id)"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2773994383")

  // update collection data
  unmarshal({
    "listRule": null,
    "viewRule": null
  }, collection)

  return app.save(collection)
})
