> Language / 语言：[简体中文](README.md) | English

# 3MF Model Manager (PrintShelf)

A **local 3MF model library** for Windows. Scan the `.3mf` files already on your computer, browse them like a photo gallery, organize them, preview them, and send a model straight to your slicer when you are ready to print.

No account required. Core features work offline and never upload your files (the optional Bambu cloud channel needs a login). Your index, categories, tags, notes, thumbnails and settings all live in the local `data/` folder. Original 3MF files are never rewritten.

![Main window](docs/screenshots/00-主界面.png)
![Dark theme](docs/screenshots/00-主界面-深色.png)
![Color shares on hover](docs/screenshots/00-主界面-色板占比.png)

## In development: 1.2.1 (not released yet)

- **Damaged-file quarantine**: 3MF files that fail to parse are no longer just placeholder cards. The **Damaged files** view can retry parsing, attempt a best-effort repair (the original is untouched; you are asked before replacing it, and the original is backed up as `.broken.bak`), move the file into a quarantine folder, send it to the Recycle Bin, or drop the index entry.
- **Merge duplicates into aliases**: pick one primary record per group; the rest become its aliases — hidden from the list, not double-counted, while notes and print records stay. The detail panel lists the aliases and lets you detach them. Merging can either only change records or also send the other files to the Recycle Bin.
- **Variants**: recolor, scale or re-export the same model and the file name and hash change while the shape stays the same. PrintShelf compares mesh shapes in the background, groups these files under **Variants**, and lets you merge confirmed ones.
- **Filament manager**: the sidebar entry opens two tabs. **Inventory** holds spools you actually own (type, color, remaining grams, full-spool weight, CNY/kg, spare spools); successful prints deduct from the matching receipt. **Filament library** is a buying/price reference with photos, brand, price and purchase links. Low stock gets a “low” badge, at most one reminder per spool per day; you can weigh a spool, add spare spools, undo each ledger entry and export a shopping-list CSV. The separate “Missing files” sidebar entry has been removed.
- **Natural-language search**: type things like “green box printed last month” or “more than 50MB two-color model”; recognized conditions become removable filter chips, unrecognized text falls back to a plain keyword. Everything runs locally and can be turned off.
- **Search by image**: a new button next to the search box lets you pick an image and lists visually similar models by thumbnail hash; clicking a result opens its details. The hash index is filled in the background after scans.
- **Weekly report / achievements / model passport**: the Print receipts page has a **This week's report** button in the top right (success rate, filament, cost, 7-day bars, Top 5). Settings → Data shows 11 achievements and exports the passport CSV with license and commercial-use info; the detail panel has a **Model passport** section.
- Also filled in semantic colors for `.badge.warn / .danger / .badge-ok` so status badges in the maintenance views are no longer bare text.

## What's new in 1.2.0

- **Chinese / English interface**: switch from the top bar, or use Settings → Appearance → Interface language. All new UI text goes through the same i18n framework.
- **MakerWorld CN + Global**: the English interface opens MakerWorld Global and the Chinese interface opens MakerWorld China by default. You can pin either site in Settings. The two sites have separate model IDs; if a model is missing on the target site, PrintShelf falls back to the other one and tells you.
- **English keyword rules**: fresh English libraries get English categories (Functional Parts / Figures & Decor / Test & Calibration / Spare Parts & Repair) with keywords commonly used by the English 3D-printing community, not literal translations of the Chinese rules.
- **Empty filament library in English**: the three sample filaments are seeded for Chinese installs only. English users start with an empty filament library.
- Cleaner cards: no star rating or object count, and the metadata line wraps instead of being cut off.
- Hover a color swatch to see each filament's share: real slice weights when available, otherwise an estimate based on per-object triangle counts.

## Getting started

### Easiest: download a release

Open the **Releases** page of this repository and download:

- **Installer**: `3MF-Model-Manager-1.2.0-setup.exe` — run it and follow the wizard; a desktop shortcut is created automatically.
- **Portable**: `3MF-Model-Manager-1.2.0-portable.zip` — unzip it to a permanent folder and run `3MF模型管理器.exe`.

> Release asset names are ASCII-only (a GitHub limitation). The app name, window title and shortcut are still the Chinese "3MF模型管理器". The version tracks `package.json`.

On first launch, pick a model folder, choose a scan depth, and start scanning. Next time you open the app, you go straight to your library.

### Run from source

Requires Windows 10/11 and Node.js 20+:

```bash
npm install
npm start
```

The project folder is still named `PrintShelf` locally; that is a historical package name.

## Features

- **Find models fast**: thumbnail wall or list view, search, filters and sorting.
- **Drag to organize**: drop a card onto a category or tag in the sidebar.
- **Open in your slicer**: Bambu Studio, OrcaSlicer and Snapmaker Orca are supported, with a per-model choice.
- **Duplicates stay quiet**: identical files collapse into one card; open Details to switch copies, or pick a primary and merge the rest into aliases (optionally sending their files to the Recycle Bin).
- **Damaged files have a home**: 3MF files that fail to parse appear under **Damaged files**, where you can retry, attempt a repair, quarantine them, or recycle them instead of leaving a placeholder card unmanaged.
- **Variants**: files with the same mesh shape (recolored, scaled, re-exported) are grouped under **Variants**, regardless of file name, and can be merged once confirmed.
- **Deleting means deleting**: remove a 3MF in Explorer and the record is dropped from the library by default — it no longer appears under Missing files and the total goes down. To keep notes, categories and print history for later re-linking, turn this off under Settings → Scan; with it on, moving or renaming a file counts as delete + add, so manual metadata does not follow.
- **Source pages are recognized**: MakerWorld links appear on the card. If the 3MF description has no URL, `DesignModelId` is used to look up the model page.
- **Print status and notes**: mark models as printed, record print counts, write notes and rate models in Details.
- **Rough cost estimates**: Chinese installs include three sample filaments; English installs start empty. Add your own filaments, set a default, and estimate cost from model weight. Hover the swatch to see per-color shares.
- **Automatic print receipts**: finished jobs are recorded with printer, duration, filament and cost, and linked back to the matching model.
- **Printer discovery and management**: scan your LAN, add or remove printers, and tidy the device list.
- **Print monitoring**: live nozzle / bed temperature and progress charts, with local history.
- **Camera preview**: built-in camera streams such as the Snapmaker U1.
- **Auto-classify with a keyword dictionary**, plus a "skip all" reminder you can reset later.
- **Optional mesh check and optimization**: find broken faces and thin triangles, then generate an optimized copy. The original is untouched.
- **Optional Snapmaker U1 conversion**: convert Bambu 3MF projects for U1 without uploading anything.

## FAQ

**Does it need internet?** No for core features: files, thumbnails and notes are handled locally. The optional Bambu cloud channel needs a login for cloud devices and jobs.

**Do I need Node?** Only if you clone the source and run it yourself. The installer and portable package include everything.

**Where is my data? How do I back it up?** By default in `data/` next to the program (inside the extracted folder for the portable build). If an installed copy sits in a read-only location such as `Program Files`, the app falls back to `userData/data` under your user profile. You can also set `PRINTSHELF_DATA_DIR` explicitly. Copying the whole `data/` folder is a complete backup.

**Will uninstalling delete my models?** No. Only the program is removed. Your original 3MF files were never modified, and the index and thumbnails can be kept.

**SmartScreen says "unknown publisher"?** That is expected for an unsigned app. Choose More info → Run anyway.

## For developers

```bash
npm install
npm start
npm run selftest
```

More details:

- `docs/09-实现说明书.md` — implementation notes (Chinese)
- `docs/16-首次启动向导与分发.md` — packaging and distribution (Chinese)
- `docs/18-交互与UIUX白皮书.md` — interaction and visual conventions (Chinese)
- `docs/21-国际化与英文发布计划书.md` — bilingual architecture and keyword strategy (Chinese)

## License

[MIT](LICENSE)
