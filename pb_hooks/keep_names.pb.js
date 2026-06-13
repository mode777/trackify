/// <reference path="../pb_data/types.d.ts" />

onBootstrap((e) => {
    e.next()
    console.log("[HOOKS] keep-names hook loaded")
})

onRecordCreate((e) => {
    let files = e.record.get("files");
    files.forEach((file) => {
        file.name = file.originalName;
    });

    e.next()
}, "games")

onRecordUpdate((e) => {
    let files = e.record.get("files");
    files.forEach((file) => {
        file.name = file.originalName;
    });

    e.next()
}, "games")