> Language / 语言：[简体中文](README.md) | English

# 3MF Model Manager (PrintShelf)

A **local 3MF model library** for Windows. Scan the `.3mf` files already on your computer, browse them like a photo gallery, organize them, preview them, and send a model straight to your slicer when you are ready to print.

No account required. Core features work offline and never upload your files (the optional Bambu cloud channel needs a login). Your index, categories, tags, notes, thumbnails and settings all live in the local `data/` folder. Original 3MF files are never rewritten.

![Main window](docs/screenshots/00-主界面.png)
![Dark theme](docs/screenshots/00-主界面-深色.png)
![Color shares on hover](docs/screenshots/00-主界面-色板占比.png)

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
- **Duplicates stay quiet**: identical files collapse into one card; open Details to switch copies, or clean up a whole group.
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
