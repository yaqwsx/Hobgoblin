# Tauri Icons

The canonical Hobgoblin app icon source is `src-tauri/icons/source.svg`.

Regenerate the Tauri icon set after editing the source:

```bash
npm run tauri -- icon src-tauri/icons/source.svg --output src-tauri/icons
```

The command generates the PNG, ICO, ICNS, Windows, iOS, and Android icon assets used by Tauri. Desktop bundle icon paths are listed in `src-tauri/tauri.conf.json`.
