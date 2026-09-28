# Contentful setup

This site pulls its FAQs, Committee and Competition calendar content from
Contentful at **build time**. There is no client-side fetch and no API key
ships to the browser — a script fetches each content type, renders it to
plain HTML, and `build.js` splices that HTML into the page between marker
comments (`<!-- @cms:faqs start/end -->` etc.), the same way it already
inlines the shared header and footer. If Contentful isn't configured yet,
the fetch scripts no-op and the pages keep their current hardcoded content.

## 1. Create the space

Create a Contentful space (or use an existing one) and note its **Space ID**
(Settings → General settings).

## 2. Create the content types

Field IDs must match exactly — the fetch scripts read them by ID.

### `faqCategory`
| Field ID | Type | Required |
|---|---|---|
| `title` | Short text | yes |
| `order` | Integer | yes |

### `faqEntry`
| Field ID | Type | Required |
|---|---|---|
| `question` | Short text | yes |
| `answer` | Rich text | yes |
| `category` | Reference → `faqCategory` | yes |
| `order` | Integer | yes |

### `committeeMember`
| Field ID | Type | Required |
|---|---|---|
| `name` | Short text | yes |
| `role` | Short text | yes |
| `bio` | Long text (plain) | no |
| `photo` | Media, one asset | no |
| `instagramUrl` | Short text | no |
| `group` | Short text, with a **predefined values** validation of exactly: `Executive team`, `Supporting committee`, `International referees`, `National referees` | yes |
| `order` | Integer | yes (sort position within its group) |

### `competition`
| Field ID | Type | Required |
|---|---|---|
| `name` | Short text | yes |
| `summary` | Long text (plain) | yes |
| `notes` | Short text, list | no (bullet points, e.g. "Entry opens 10 Jan at 9am") |
| `extraNote` | Rich text | no (a second paragraph — announcements, entry requirements; may contain links/bold) |
| `tag` | Short text | no (small badge, e.g. "Sponsor TBD") |
| `dateLabel` | Short text | yes (free text, so both "11 Apr 2026" and "24–25 Jan 2026" work) |
| `venue` | Short text | yes |
| `lifterCap` | Integer | no |
| `order` | Integer | yes |

Add an `order` field validation (or just discipline) so numbers are unique
per list — it's what controls display order.

## 3. Get a Content Delivery API token

Settings → API keys → Add API key. Copy the **Content Delivery API - access
token** (read-only, safe to use in a build; do not use the Content
Management or Preview tokens here).

## 4. Add credentials

Add two secrets so the build can read them — as GitHub Actions repository
secrets (Settings → Secrets and variables → Actions) for CI, and locally as
environment variables if you want to run the fetch scripts yourself:

- `CONTENTFUL_SPACE_ID`
- `CONTENTFUL_DELIVERY_TOKEN`

(Optional: `CONTENTFUL_ENVIRONMENT`, defaults to `master`.)

## 5. Run it

```bash
export CONTENTFUL_SPACE_ID=...
export CONTENTFUL_DELIVERY_TOKEN=...
node scripts/fetch-faqs.js
node scripts/fetch-committee.js
node scripts/fetch-competitions.js
node build.js
```

This writes `assets/data/{faqs,committee,competitions}-content.html` and
splices them into `faqs.html`, `committee.html` and `calendar.html`. Commit
the result like any other content change.

## 6. Automate it

`.github/workflows/contentful-sync.yml` already runs all three fetch
scripts plus `node build.js` and commits the result:

- daily, on a schedule
- on demand, via "Run workflow" in the Actions tab
- on a `repository_dispatch` event of type `contentful-publish`

For near-instant publishing, add a Contentful webhook (Settings → Webhooks)
that fires on **Entry publish/unpublish/delete** for the four content types
above, and have it call the GitHub API to trigger that dispatch event:

```
POST https://api.github.com/repos/<owner>/<repo>/dispatches
Authorization: Bearer <a GitHub PAT with repo scope, stored as a Contentful webhook secret header>
Content-Type: application/json

{ "event_type": "contentful-publish" }
```

Without the webhook, content still goes live daily via the scheduled run,
or immediately via a manual "Run workflow" click.

## Adding a blog later

The same pattern extends to a `blogPost` content type (title, slug, rich
text body, published date, author). The one difference is it needs a page
*generator* rather than a fragment splice, since each post is its own URL —
`build.js` would grow a step that writes one `blog/<slug>.html` per entry
from a template, plus a listing page. Worth doing once FAQs, Committee and
Competitions have proven the pipeline in production.
