/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2773994383")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_9fqlznd1sz` ON `playlist_tracks` (`playlist`)",
      "CREATE UNIQUE INDEX `idx_9gnrmz065w` ON `playlist_tracks` (\n  `track`,\n  `playlist`\n)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2773994383")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_9fqlznd1sz` ON `playlist_tracks` (`playlist`)"
    ]
  }, collection)

  return app.save(collection)
})
