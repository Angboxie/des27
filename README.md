# DES Website

Website for the Design Engineering Society, built with [Eleventy](https://www.11ty.dev/) (plain HTML, CSS and JS with Nunjucks templates).

All page text and data is placeholder until the content and designs are finalised.

## Getting started

Requires Node 20+ (see `.nvmrc`).

```bash
npm install
npm start        # dev server at http://localhost:8080 with live reload
npm run build    # outputs the site to _site/
```

## Project structure

```
src/
  _data/            site content as JSON (events, partners, merch, nav)
  _includes/
    layouts/        base.njk (html shell), page.njk (inner pages with title)
    partials/       header and footer
    components/     reusable macros - button, card
  assets/
    css/            tokens.css (colours, fonts, spacing), base, layout, components
    js/             nav.js (mobile menu)
    images/
  *.njk             one file per page
```

## Updating content

Most content lives in `src/_data/`, so it can be edited without touching templates.

- **Events** - `events.json`. Set `status` to `"upcoming"` or `"past"` to choose which list it appears in. Dates use `YYYY-MM-DD`.
- **Partners** - `partners.json`
- **Merchandise** - `merchandise.json`. `price` is a number (e.g. `15` shows as £15.00), or `null` for "Price TBC".
- **Navigation** - `site.json`

Images go in `src/assets/images/` and are referenced as `/assets/images/filename.jpg`.

Entries marked `"placeholder": true` are sample data and should be replaced or removed.

## Styling

Colours, fonts and spacing are CSS variables in `src/assets/css/tokens.css`. Update these first when the Figma designs come in.

Anything with the `.placeholder` class is temporary content.

## Components

Import a macro at the top of a page, then call it:

```njk
{% from "components/button.njk" import button %}
{% from "components/card.njk" import card %}

{{ button("View events", "/events/") }}
{{ button("About", "/about/", "secondary") }}

{{ card({ title: "Title", text: "Description", meta: "Date", image: "/assets/images/x.jpg", url: "/link/" }) }}
```

## Not built yet

- Merchandise ordering / payments
- Locker booking and backend

## Deployment

Hosted on Netlify. Settings are in `netlify.toml`:

- Build command: `npm run build`
- Publish directory: `_site`

To set up: in Netlify, choose *Add new site > Import an existing project*, pick this GitHub repo, and it will use the settings above. Pushes to `main` deploy automatically.
