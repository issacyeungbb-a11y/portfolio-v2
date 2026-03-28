# Firebase Security Checklist

## 1. Authentication

- Enable `Authentication` -> `Sign-in method` -> `Anonymous`

## 2. Cloud Firestore

- Create `Build` -> `Firestore Database`
- Publish the rules in [`firebase/firestore.rules`](/Users/yinwaiyeung/Documents/Playground/Portfolio_V2/firebase/firestore.rules)

## 3. Server-side Firebase Admin credentials

Vercel Functions now verify Firebase ID tokens for:

- `/api/extract-assets`
- `/api/update-prices`
- `/api/analyze`

Set one of these in Vercel Project Settings -> Environment Variables:

### Option A

- `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`

### Option B

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

Do not put Firebase Admin credentials in `VITE_*` variables.

## 4. Frontend env vars

Keep the existing Firebase Web SDK variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## 5. Current Firestore collections covered by rules

- `users/{uid}`
- `users/{uid}/assets/{assetId}`
- `users/{uid}/priceUpdateReviews/{assetId}`
- `users/{uid}/analysisCache/{snapshotHash}`

## 6. Still to add later

When you implement screenshot import history or Storage-backed uploads, add rules for:

- `users/{uid}/imports/{importId}`
- Firebase Storage upload paths
