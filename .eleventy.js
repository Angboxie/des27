module.exports = async function (eleventyConfig) {
  // Adds pathPrefix (set at the bottom) to links and asset URLs in the built HTML
  const { HtmlBasePlugin } = await import("@11ty/eleventy");
  eleventyConfig.addPlugin(HtmlBasePlugin);

  // CSS, JS and images are copied across as-is
  eleventyConfig.addPassthroughCopy("src/assets");

  eleventyConfig.addFilter("readableDate", (value) => {
    if (!value) return "Date TBC";

    return new Date(value).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  });

  // Pieces of a date for the event designs, e.g. "Mar", "16", "Sat"
  eleventyConfig.addFilter("datePart", (value, part) => {
    if (!value) return "TBC";

    const options = {
      month: { month: "short" },
      day: { day: "numeric" },
      weekday: { weekday: "short" },
    }[part];

    return new Date(value).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  });

  const byDate = (a, b) => new Date(a.date) - new Date(b.date);

  eleventyConfig.addFilter("upcomingEvents", (events) => {
    return events.filter((event) => event.status === "upcoming").sort(byDate);
  });

  eleventyConfig.addFilter("pastEvents", (events) => {
    return events.filter((event) => event.status === "past").sort(byDate).reverse();
  });

  // The event marked "featured" (or the next upcoming one)
  eleventyConfig.addFilter("featuredEvent", (events) => {
    const upcoming = events.filter((event) => event.status === "upcoming").sort(byDate);
    return upcoming.find((event) => event.featured) || upcoming[0];
  });

  eleventyConfig.addFilter("price", (value) => {
    if (value == null) return "Price TBC";
    return "$" + Number(value).toFixed(2);
  });

  eleventyConfig.addFilter("limit", (items, count) => items.slice(0, count));

  // Unique values of a field across items, e.g. every software in resources.json
  eleventyConfig.addFilter("uniqueValues", (items, key) => {
    const values = items.flatMap((item) => [].concat(item[key] || []));
    return [...new Set(values)].sort();
  });

  // Big word + script word for a title, e.g. "Poster Design Lab" -> POSTER / Design Lab
  eleventyConfig.addFilter("titleParts", (event) => {
    if (event.headline) return { big: event.headline, script: event.headlineAccent || "" };
    const [first, ...rest] = event.title.split(" ");
    return { big: first, script: rest.join(" ") };
  });

  const registrationLabels = { open: "Registrations open", "coming-soon": "Coming soon", closed: "Registrations closed" };
  eleventyConfig.addFilter("registrationLabel", (status) => registrationLabels[status] || "");


  /* Add to Calendar - times are Melbourne local time */

  const compact = (date, time) => date.replace(/-/g, "") + (time ? "T" + time.replace(":", "") + "00" : "");
  const nextDay = (date) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const eventTimes = (event) => event.startTime
    ? [compact(event.date, event.startTime), compact(event.date, event.endTime || event.startTime)]
    : [compact(event.date), compact(nextDay(event.date))];

  eleventyConfig.addFilter("googleCalendarLink", (event) => {
    const [start, end] = eventTimes(event);
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: event.title,
      dates: `${start}/${end}`,
      details: event.summary || "",
      location: event.location || "",
      ctz: "Australia/Melbourne",
    });
    return "https://calendar.google.com/calendar/render?" + params.toString();
  });

  // Contents of a downloadable .ics file (Apple Calendar, Outlook, etc.)
  eleventyConfig.addFilter("icsFile", (event, siteName) => {
    const [start, end] = eventTimes(event);
    const escape = (text) => String(text || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const when = event.startTime
      ? [`DTSTART;TZID=Australia/Melbourne:${start}`, `DTEND;TZID=Australia/Melbourne:${end}`]
      : [`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`];
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `PRODID:-//${siteName}//Events//EN`,
      "BEGIN:VEVENT",
      `UID:${event.id}@des27`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      ...when,
      `SUMMARY:${escape(event.title)}`,
      `DESCRIPTION:${escape(event.summary)}`,
      `LOCATION:${escape(event.location)}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  });

  eleventyConfig.addShortcode("year", () => String(new Date().getFullYear()));

  return {
    // GitHub Pages serves the site from /des27/, so links need that prefix there.
    // Locally and on Netlify it stays "/".
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: {
      input: "src",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
