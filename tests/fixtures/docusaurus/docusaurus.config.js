module.exports = {
  title: "PushDocs preview fixture",
  url: "https://docs.example.test",
  baseUrl: "/",
  i18n: { defaultLocale: "ru", locales: ["ru", "en"] },
  presets: [["classic", { docs: { routeBasePath: "/", sidebarPath: false }, blog: false }]],
};
