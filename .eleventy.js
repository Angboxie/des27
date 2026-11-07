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

  const byDate =(a, b) => new Date(a.date) - new Date(b.date);

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
    return "£" + Number(value).toFixed(2);
  });

  eleventyConfig.addFilter("limit", (items, count) => items.slice(0, count));

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
