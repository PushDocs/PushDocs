// Regression for facebook/docusaurus#11974. Keep the fixture lockfile reproducible.
const webpack = require("webpack");
const WebpackBar = require("webpackbar");
webpack({ mode: "none", plugins: [new WebpackBar({ name: "test", color: "blue" })] });
console.log("ProgressPlugin compatibility: PASS");
