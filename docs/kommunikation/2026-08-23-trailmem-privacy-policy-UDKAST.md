# Privacy Policy — draft for trailmem.com/privacy

**Status:** DRAFT, awaiting Christian's GO. Not published.
**Why it exists:** the Chrome Web Store refuses a listing without a privacy
policy URL when an extension handles user data, and the Trail Web Clipper reads
page content. `trailmem.com/privacy` currently returns 404 (F208.3).

**Where it must be published:** the production CMS at `https://webhouse.app/admin`
— org `broberg-ai`, site `trail-landing`. NOT the local admin (repo HARD RULE:
local writes never reach the live site).

**Accuracy note:** every claim below was checked against the code, not assumed.
The clipper sends to whichever server the user configures (`app.trailmem.com` by
default since F208.1), stores its token in `chrome.storage.local`, and makes no
other network calls — there is no analytics library and no third-party endpoint
anywhere in `apps/web-clipper/src`.

---

## Privacy Policy

_Last updated: 23 August 2026_

Trail is made by **WebHouse ApS**, Denmark. This policy covers the Trail service
at trailmem.com and the **Trail Web Clipper** browser extension.

### The short version

Trail is a place to keep your own knowledge. We do not sell your data, we do not
profile you, and there is no advertising or third-party tracking anywhere in the
product. The Web Clipper only reads a page when you ask it to, and sends it only
to the Trail server you have configured.

### What the Web Clipper does

The extension is idle until you click its toolbar button. When you click it:

- it reads the **content of the page you are currently on** — the article text,
  its title, and its URL;
- it converts that page to text and sends it to **the Trail server you chose in
  the extension's settings**, together with any tags you typed.

It does not read pages in the background, it does not run on pages you have not
clipped, and it does not watch your browsing.

**Where your clip goes is your choice.** By default the extension sends to
`app.trailmem.com`. You can point it at your own Trail server instead, including
one running on your own machine — in which case the clipped page never reaches
us at all.

### What the extension stores on your device

- The **server address** you configured.
- Your **API token** for that server.

Both are kept in your browser's local extension storage, on your own device. The
token is what proves the clip is yours; it is never sent anywhere except to the
Trail server you configured, as the credential for your own upload.

### What we store on our servers

If you use the hosted Trail at `app.trailmem.com`:

- the pages and documents you send us, and the notes and knowledge Trail derives
  from them;
- your account details (name, email) and your knowledge base settings;
- ordinary operational logs needed to run and secure the service.

Your content is yours. It is used to operate Trail for **you** — to search it, to
answer your questions from it, and to keep it available. It is not sold, not
shared with other customers, and not used to train third-party models.

### Deleting your data

You can delete individual documents from Trail at any time, and you can ask us
to delete your account and everything in it. Write to
**[cb@webhouse.dk](mailto:cb@webhouse.dk)** and we will remove it.

You can also remove the extension's stored settings by uninstalling it, which
clears its local storage.

### Permissions the extension asks for, and why

- **activeTab** — lets the extension read the page you are on, *only at the
  moment you click the button*.
- **scripting** — used to run the page-extraction code on that page when you
  click.
- **storage** — to remember your server address and token on your device.
- **Access to `app.trailmem.com` and `127.0.0.1`** — the two Trail servers the
  extension can upload to. If you configure a different server, your browser
  asks your permission for that address at that point.

### Your rights (GDPR)

WebHouse ApS is the data controller. You have the right to access, correct,
export and delete your personal data, and to object to processing. Contact
**cb@webhouse.dk**. You may also complain to the Danish Data Protection Agency
(Datatilsynet).

### Contact

**WebHouse ApS**
Denmark
[cb@webhouse.dk](mailto:cb@webhouse.dk)

### Changes

If this policy changes materially, we will update the date above and, for
account holders, say so by email.
