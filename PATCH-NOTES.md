# DogEar quick-start popup integration

## Files to merge
- `src/popup/ui/Popup.tsx` — adds a “Read the quick start guide” action.
- `src/popup/ui/popup.css` — styles the new action and updates the visible footer shortcut to Alt+Shift+Z.
- `public/QUICK-START.html` — offline quick-start guide opened from the popup.
- `public/assets/` — screenshots used by the guide.
- `README.md` and `DogEar-User-Manual.pdf` — repository documentation.

## Why no Vite configuration change is needed
Vite copies the contents of its default `public/` directory to the root of `dist/` during production builds. The popup opens `chrome.runtime.getURL('QUICK-START.html')`, so the guide is available offline in the installed extension.

## Apply
Merge the files into the matching locations in the DogEar repository. Keep your existing `public/icons/` folder and manually selected icon files untouched.

Then run:
```powershell
npm run check
npm run build
```

After a successful build, reload the unpacked extension at `edge://extensions`. Open the popup and select “Read the quick start guide”.

The shortcut text shown in the popup is synchronized to the supplied manifest's `Alt+Shift+Z`.
