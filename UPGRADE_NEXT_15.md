# Next.js 15 Upgrade

The source already uses the asynchronous request APIs required by Next.js 15.

Run these commands from the project directory when package downloads are available:

```powershell
npm install next@15.5.15 react@19.1.6 react-dom@19.1.6
npm install -D @types/react@19 @types/react-dom@19 eslint-config-next@15.5.15
npm run check
```

Do not deploy the upgrade unless the final `npm run check` completes successfully.
