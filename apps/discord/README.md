# ustp-discord

The Discord bot's slash commands (design §10.18). Discord sends each command and button press to `POST /interactions`,
signed; this service checks the signature and answers from the site's public api. It holds no credentials: the key it
checks with is the application's public key, which it reads from the site (`GET /v1/public/discord/app`).

The commands are `DISCORD_COMMANDS` in `packages/domain/src/discord/commands.ts`, and so is what each answers. The
worker tells Discord the list and this service's address by itself (`apps/server/src/discord/discord-commands.ts`).

```
npm run build -w packages/domain -w apps/discord
node apps/discord/dist/main.js --site https://ustpvote2-dev.web.app
```

`GET /health` answers `ok`. A request Discord did not sign is answered 401, so the service cannot be tried by hand
without the application's private key, which only Discord holds; the tests sign with a key of their own
(`src/http.test.ts`).
