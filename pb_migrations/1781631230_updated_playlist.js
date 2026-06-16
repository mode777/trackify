/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2546747700")

  // update collection data
  unmarshal({
    "name": "playlists"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2546747700")

  // update collection data
  unmarshal({
    "name": "playlist"
  }, collection)

  return app.save(collection)
})
