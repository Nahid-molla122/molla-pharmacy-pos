# Pharmacy Quick POS

A mobile-first pharmacy point-of-sale app built with React, Vite, Express, and MongoDB.

## Run locally

Requirements: Node.js 20.19+ and MongoDB 7.0+ (local or hosted).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`. Set `MONGODB_URI`, a unique `JWT_SECRET` of at least 32 characters, and the initial administrator's email and password. Use a unique bootstrap password of at least 12 characters.

3. Start the API and frontend in separate terminals:

   ```bash
   npm run server
   npm run dev
   ```

   Open the Vite URL and sign in using the bootstrap administrator credentials. The API listens on port 3001; Vite proxies `/api` requests to it. To scan receipt QR codes with a phone on your local network, open the POS using Vite's **Network** URL (not `localhost`) and connect the phone to the same Wi-Fi.

The bootstrap account is created only when the database has no active administrator. Remove the bootstrap password from the deployment environment after initial setup. Keep `.env` private and never commit real credentials.

## Accounts and access

- Only the main administrator can access account management or its API, and can create accounts using any non-empty account identifier (it does not need to be an email address) and passwords of at least 4 characters. They can edit account names, identifiers, roles, and passwords, activate/deactivate accounts, and delete accounts. Other administrators have product-management access but cannot manage accounts. The initial bootstrap administrator still requires a valid email address and a password of at least 12 characters.
- Users can make and review sales, but cannot save or edit products or delete saved records. These restrictions are checked by the API as well as the UI.
- At least one active administrator must remain. The original bootstrap administrator is marked as the main administrator and cannot be deleted. Administrators cannot deactivate, demote, or delete their own account.
- Passwords are stored as bcrypt hashes. Sign-in uses an HTTP-only session cookie and is rate limited.

## Data and deployment

Products, sales, and POS settings are stored in MongoDB and loaded from the API after sign-in. The app does not read or write POS data in browser storage. Existing browser-local data is not imported; ensure any needed data is already in MongoDB before upgrading. Sales History and report records are stored independently: deleting a history receipt does not change report totals, while hiding a daily/monthly report period does not delete history sales or affect Today/This Month totals. New sales are added to both, and restore the current day/month report if it was hidden.

Deploy the API and frontend behind HTTPS, preferably on the same origin with a reverse proxy forwarding `/api` to the Express server. Configure `FRONTEND_ORIGIN` only when cross-origin API access is required. Set `NODE_ENV=production` so session cookies are marked secure. Back up MongoDB regularly.

The API uses optimistic revisions for POS data; if a second session saves first, the stale session refreshes instead of overwriting newer shared data. Pharmacy data is stored as a shared document; high-volume deployments should migrate to indexed, paginated collections.

## Existing POS features

- Quick sales, saved product search with camera OCR, discounts, receipts with unique customer QR links, reports, and sales history.
- Sales history can open WhatsApp with a formatted receipt text message ready to send.
- Scanning a receipt QR opens a public, read-only receipt page; customers can print or save it from their device. For local testing, open the POS with Vite's Network URL on the computer and scan from a phone on the same Wi-Fi. For customers outside your local network, deploy the POS website and API on a customer-accessible HTTPS address. Receipt QR codes are not generated when the app is opened on `localhost`, since that address cannot be reached from another device.
- Product CSV and Excel import/export.
- Daily/monthly sales reporting using Asia/Dhaka calendar dates.

Camera scanning requires camera permission and a secure HTTPS connection. OCR reads English text on the device; the OCR engine may need internet access on its first use.

Validate quantities, rounding, accounting, backups, and printing on your target devices before production use.
