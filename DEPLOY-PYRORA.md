# Deploy PYRORA Free

Best free host for this app: Koyeb.

Why Koyeb:
- It supports dynamic Node web services on the free tier.
- The free web service has 512MB RAM, 0.1 vCPU, and 2GB SSD.
- This app does not need a database.

Important:
- Free hosting is not the same as guaranteed production uptime.
- If a provider blocks heavy scraping or external API traffic, move to a small paid plan.
- The phone URL will become the Koyeb URL, not `192.168.0.6`.

## Steps

1. Push this folder to a GitHub repo.
2. Go to https://www.koyeb.com/
3. Create a new Web Service.
4. Choose GitHub as the source and select the repo.
5. Runtime: Node.js.
6. Build command: leave blank or use `npm install`.
7. Run command: `npm start`.
8. Instance type: Free.
9. Deploy.

After deployment, open the public Koyeb URL:

`https://your-service-name.koyeb.app/spinecoin.html`

## If using Render instead

Render is easier, but its free web service spins down after 15 minutes idle, so the first load can take about a minute.

Build command:

`npm install`

Start command:

`npm start`
