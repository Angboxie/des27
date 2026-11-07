module.exports = function (eleventyConfig) {
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

  const byDate = (a, b) => new Date(a.date) - new Date(b.date);

  eleventyConfig.addFilter("upcomingEvents", (events) => {
    return events.filter((event) => event.status === "upcoming").sort(byDate);
  });

  eleventyConfig.addFilter("pastEvents", (events) => {
    return events.filter((event) => event.status === "past").sort(byDate).reverse();
  });

  eleventyConfig.addFilter("price", (value) => {
    if (value == null) return "Price TBC";
    return "£" + Number(value).toFixed(2);
  });

  eleventyConfig.addFilter("limit", (items, count) => items.slice(0, count));

  eleventyConfig.addShortcode("year", () => String(new Date().getFullYear()));

  return {
    dir: {
      input: "src",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
