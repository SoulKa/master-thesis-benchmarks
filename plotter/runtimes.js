const COLORS = require("./colors.json");

/** @type {import("./types").RuntimeObject[]} */
const RUNTIMES = [{ id: "linux", name: "Linux" }, { id: "occlum", name: "Occlum" }, { id: "gramine", name: "Gramine" }, { id: "hybrid.scone-s1", name: "SCONE switchful" }, { id: "scone", name: "SCONE" }, { id: "scone-s3", name: "TAB" }, { id: "scone-s1", name: "CTRL balanced" }, { id: "balanced.scone-s1", name: "CTRL balanced" }, { id: "eco.scone-s1", name: "CTRL eco" }, { id: "performance.scone-s1", name: "CTRL perf." }];
RUNTIMES.forEach( (r, i) => {
    r.color = COLORS[i%COLORS.length];
    r.index = i;
});
const RUNTIME_IDS = new Set(RUNTIMES.map( r => r.id ));

module.exports = {
    RUNTIMES,
    RUNTIME_IDS
};