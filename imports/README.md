# imports/

Drop files downloaded from Google Drive here (one subfolder per `driveDownloads` entry in `docs-sources.json`).

1. In Google Drive, right-click the folder → **Download**. Google turns Docs into `.docx` and zips them.
2. Move the `.zip` into e.g. `imports/shared-drive/`. No need to unzip; a single `.docx` or `.md` works too.
3. Run `make sync`.

Re-downloading? Delete the old zip first so removed docs disappear from the site.
