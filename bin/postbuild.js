// Next standalone output does not include static assets; copy them so the bin can serve them.
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const cp = (a, b) => fs.existsSync(a) && fs.cpSync(a, b, { recursive: true });
cp(path.join(root, ".next", "static"), path.join(root, ".next", "standalone", ".next", "static"));
cp(path.join(root, "public"), path.join(root, ".next", "standalone", "public"));
