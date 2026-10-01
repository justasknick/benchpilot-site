# BenchPilot website

Static site (HTML + one CSS file + one small script). No build step, no frameworks. The only network request is the password-reset page talking to your Supabase project. Hosted free on GitHub Pages.

Files: `index.html`, `privacy.html`, `terms.html`, `refund.html`, `contact.html`, `shipping.html`, `verified.html`, `reset-password.html`, `404.html`, `styles.css`, `assets/logo-mark.svg` (BenchPilot mark, copied from the extension), `assets/fonts/*.woff2` (Familjen Grotesk, IBM Plex Sans, IBM Plex Mono; SIL Open Font License, copied from the extension), `assets/reset-password.js`, `assets/verified.js`.

## 1. Replace the placeholders first

Open each `.html` file in a text editor (Notepad, VS Code) and use Find and Replace (Ctrl+H) across all files. Replace these exact tokens:

| Token | Replace with | Example |
|---|---|---|
| `nicklennox30@gmail.com` | your support email | `hello@example.com` |
| `REPLACE_ME_CHROME_STORE_URL` | your Chrome Web Store listing URL (fill after the extension is approved) | `https://chromewebstore.google.com/detail/...` |
| `Rakessh.D` | your legal name (individual seller) | `Your Full Name` |
| `Hyderabad, Telangana, India` | operating address, city and state (shown on Contact Us; Razorpay verifies this) | `Hyderabad, Telangana` |

Tip: search for `REPLACE_ME` afterwards. It should find nothing. (Until the Chrome Web Store URL is known, the "Add to Chrome" buttons will not work; you can publish the site first to get the privacy policy URL that the store asks for, then update the buttons later.)

## 2. Publish on GitHub Pages (free)

1. Create a free account at https://github.com/signup and verify your email.
2. Click **+** (top right) → **New repository**. Name it `benchpilot`, set it to **Public**, and click **Create repository**.
3. On the empty repository page click **uploading an existing file** (or **Add file → Upload files**).
4. Open the `website` folder on your computer, select everything **inside** it (`index.html`, `privacy.html`, `terms.html`, `refund.html`, `contact.html`, `shipping.html`, `verified.html`, `reset-password.html`, `404.html`, `styles.css`, `README.md` and the `assets` folder, which includes `reset-password.js`, `verified.js`, `logo-mark.svg` and the `fonts` folder) and drag it into the browser. Upload the contents, not the `website` folder itself, so `index.html` is at the top level.
5. Scroll down and click **Commit changes**.
6. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose branch **main** and folder **/ (root)**, and click **Save**.
7. Wait 1–2 minutes and refresh. GitHub shows your live address: `https://<your-username>.github.io/benchpilot/`.

To update later: open the file in the repository, click the pencil icon, edit, and commit. Or use **Add file → Upload files** to replace files.

## 3. URLs for the Chrome Web Store

In the developer dashboard listing, use:

- **Homepage URL:** `https://<your-username>.github.io/benchpilot/`
- **Privacy policy URL:** `https://<your-username>.github.io/benchpilot/privacy.html`
- Also useful: support URL `https://<your-username>.github.io/benchpilot/` and, in the extension's `lib/config.js`, set `WEBSITE_URL` to the homepage.

`verified.html` and `reset-password.html` are the pages Supabase sends people to after they confirm their email or click "reset password". Add their addresses in Supabase (see `docs/SETUP_ACCOUNTS.md`, Part A).

## 4. Checklist

- [ ] All `REPLACE_ME_*` tokens replaced in every `.html` file
- [ ] Chrome Web Store URL added after approval
- [ ] Opened the live site on your phone and desktop
- [ ] Privacy URL pasted into the Chrome Web Store listing

## 5. Razorpay website verification

Razorpay checks the site before activating payments. It needs: pricing in ₹ (on the home page), Contact Us (`contact.html`), Terms, Privacy, Refund/Cancellation and Shipping & Delivery (`shipping.html`) pages, all linked in the footer. Publish the site with placeholders filled (including the address) before submitting it in the Razorpay dashboard.

## 6. Admin page (founder only)

`admin.html` (+ `admin.js`, `admin.css`, `admin-lib.js`) is the founder admin console: search a user, give a Basic/Pro plan for N days, revoke a grant, see payments. It is not linked from any page and has `noindex`. Once published it lives at `https://justasknick.github.io/benchpilot-site/admin.html`.

- It only talks to your Supabase project (Auth REST + the `admin` edge function). No third-party scripts; a strict CSP is set in the page.
- Access needs all three: a Supabase account, a row in the `admins` table (added by you in the SQL editor), and TOTP two-step verification. On first sign-in the page shows a QR code to enrol your authenticator app; afterwards it asks for the 6-digit code each time. The session lives in `sessionStorage` and disappears when the tab closes.
- The `admin` function only accepts requests from the origin in its `ADMIN_ORIGIN` secret (default `https://justasknick.github.io`).
- Go-live order is in `supabase/README.md` ("Admin console: deploy order"). Upload `admin.html`, `admin.js`, `admin.css` and `admin-lib.js` next to the other site files.
- Tests for the helpers: `node --test website/test/*.test.js`.
