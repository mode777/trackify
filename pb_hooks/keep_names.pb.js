/// <reference path="../pb_data/types.d.ts" />

onBootstrap((e) => {
    e.next()
    console.log("[HOOKS] keep-names hook loaded")
})

onRecordCreate((e) => {
    try {
        const files = e.record.get("files");
        if (files && Array.isArray(files)) {
            files.forEach((file) => {
                file.name = file.originalName;
            });
        }

        const coverArt = e.record.get("coverArt");
        if (coverArt && coverArt.originalName) {
            coverArt.name = coverArt.originalName;
        }
    } catch (err) {
        console.error("[HOOKS] keep-names onRecordCreate error:", err)
    }

    e.next()
}, "games")

onRecordUpdate((e) => {
    try {
        const files = e.record.get("files");
        if (files && Array.isArray(files)) {
            files.forEach((file) => {
                file.name = file.originalName;
            });
        }

        const coverArt = e.record.get("coverArt");
        if (coverArt && coverArt.originalName) {
            coverArt.name = coverArt.originalName;
        }
    } catch (err) {
        console.error("[HOOKS] keep-names onRecordUpdate error:", err)
    }

    e.next()
}, "games")