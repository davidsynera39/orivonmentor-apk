// Set ORIVON_URL to your deployed Orivon server (https, no trailing slash) before syncing.
// e.g.  ORIVON_URL=https://orivon.onrender.com npx cap sync android
const url = (process.env.ORIVON_URL || "https://YOUR-ORIVON-SERVER.example.com").replace(/\/$/, "");
const host = new URL(url).host;

module.exports = {
  appId: "com.orivon.app",
  appName: "Orivon",
  webDir: "www",
  server: {
    url,                       // load the live app so cookie login, uploads, exports & payments work unchanged
    cleartext: false,
    errorPath: "offline.html", // shown if the server can't be reached
    allowNavigation: [host, "*.paystack.com", "*.paystack.co"],
  },
  android: { allowMixedContent: false },
};
