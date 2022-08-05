"use strict";

const NO_METADATA = process.argv.includes("--no-meta");
const NO_PDF = process.argv.includes("--no-pdf");

const PLOT_FILETYPES = [".png", ".svg"];
if (!NO_PDF) PLOT_FILETYPES.push(".pdf");
const COLORS = require("./colors.json");
const { RUNTIMES, RUNTIME_IDS } = require("./runtimes");
const PLOTLY_CONFIG = require("./plotly-credentials.json");

const { parseCsv } = require("./csvParser");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream");
const plotly = require("plotly")(PLOTLY_CONFIG.username, PLOTLY_CONFIG.apiKey);
const glob = require("glob");

// create dirs
const PLOT_DIR = path.join(__dirname, "../plots");
const DATA_DIR = path.join(__dirname, "../data");
if (!fs.existsSync(PLOT_DIR)) fs.mkdirSync(PLOT_DIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

if (NO_METADATA) console.warn("Not updating metadata files!");

// find all benchmark files
/** @type {[string, import("./types").PlotConfigProcessedObject][]}*/
const PLOT_CONFIG_FILES = [];
glob
    .sync("**/plots.json", { cwd: DATA_DIR, strict: true, nosort: true, nodir: true })
    .forEach(f => {
        /** @type {import("./types").PlotConfigObject[]} */
        const configs = require(path.join(DATA_DIR, f));
        const d = path.dirname(f);
        configs.forEach( c => {
            if (c.files == null) c.files = "**/*.json"
            if (Array.isArray(c.files)) c.files = c.files.map( pattern => glob.sync(pattern, { cwd: path.join(DATA_DIR, d), strict: true, nosort: true, nodir: true }) ).flat();
            if (typeof c.files === "string") c.files = glob.sync(c.files, { cwd: path.join(DATA_DIR, d), strict: true, nosort: true, nodir: true });
            c.files = c.files.filter(f => RUNTIME_IDS.has(path.parse(f).name))
                .map(f => {
                    const runtime = RUNTIMES.find( r => r.id === path.parse(f).name );
                    const content = fs.readFileSync(path.join(DATA_DIR, d, f), "utf8");
                    const fileInfo = path.parse(f);
                    let obj = null;
                    try {
                        switch (fileInfo.ext) {
                            case ".json": obj = JSON.parse(content); break;
                            case ".csv":
                                obj = parseCsv(content);
                                const jsonFilepath = path.join(DATA_DIR, d, fileInfo.dir, fileInfo.name+".json");
                                if (fs.existsSync(jsonFilepath)) Object.assign(obj, require(jsonFilepath));
                                break;
                            default: throw new TypeError(`Unknown benchmark file type "${path.parse(f).ext}"!`);
                        }
                    } catch(e) {
                        console.error(`Error while parsing file ${f}:`, e);
                        throw new Error("Could not parse all files");
                    }
                    return [ runtime, obj ];
                });
            c.files = Array.from(new Set(c.files));
            PLOT_CONFIG_FILES.push([d, c]);
        });
    });

/** @type {[string, import("./types").HardwareConfigObject][]} */
const HARDWARE_CONFIG_FILES = glob.sync(`**/hardware.json`, { cwd: DATA_DIR, strict: true, nosort: true, nodir: true }).map( f => path.join(DATA_DIR, f) ).map(f => [f, require(f)]);

/**
 * 
 * @param {{ [directory: string]: (string|[string, string])[] }} obj 
 */
function extractFilepaths( obj, currentPath = path.join(__dirname, "../../thesis/assets/") ) {
    /** @type {[string, string][]} */ let res = [];
    for (const [k, v] of Object.entries(obj)) {
        const destDir = path.join(currentPath, k);
        if (Array.isArray(v)) {
            for (const filepaths of v) {
                let sourcePath = "";
                let destPath = destDir;
                if (Array.isArray(filepaths)) {
                    sourcePath = path.join(__dirname, "../plots/", filepaths[0]);
                    destPath = path.join(destDir, filepaths[1]);
                } else {
                    sourcePath = path.join(__dirname, "../plots/", filepaths);
                    destPath = path.join(destDir, path.basename(filepaths));
                }
                res.push([sourcePath, destPath]);
            }
        } else {
            res = res.concat(extractFilepaths(v, destDir));
        }
    }
    return res;
}

const FILES_TO_MOVE = new Map(extractFilepaths(require("./file-list.json")));

const DASH_CONFIG = new Map([
    ["11", "dash"],
    ["12", "dot"],
    ["14", "longdash"],
    ["18", "longdashdot"],
    ["44", "dashdot"],
    ["88", "solid"]
]);

/** @param {string} queueConfig */
function getDashConfig( queueConfig ) {
    return DASH_CONFIG.get(queueConfig) || "dashdot";
}

/**
 * Returns the value of a given environment variable, extracted
 * from the given environment variable array. If it is not included
 * in the array, undefined is returned
 * @param {string[]} envArray An array of "env=var" strings 
 * @param {string} envName The name of the environment variable (case sensitive)
 * @returns The value as string or undefined
 */
function getEnvironmentVariableFromString(envArray, envName) {
    try {
        for (const env of envArray) {
            const [e, v] = env.split("=");
            if (e === envName) return v;
        }
    } catch (e) {
        console.error("Error while splitting the given environment string array:", e);
    }
}

/**
 * Returns a color code depending on the benchmark configuration
 * and the runtime that created the benchmark
 * @param {import("./types").BatchDataObject} benchmark The benchmark file content
 * @param {import("./types").RuntimeObject} runtime The runtime that created the benchmark
 */
function getColor( benchmark, runtime ) {
    if (typeof benchmark.color === "number") return COLORS[benchmark.color % COLORS.length];
    else if (typeof benchmark.color === "string") return benchmark.color;
    return runtime.color;
}

/**
 * 
 * @param {string} directory 
 */
function getHardwareConfigForDirectory( directory ) {
    directory = path.join(DATA_DIR, directory);
    for (const [f, c] of HARDWARE_CONFIG_FILES) {
        if (!path.relative(path.dirname(f), directory).includes("../")) return c;
    }
    return null;
}

/**
 * Converts microseconds to CPU cycles
 * @param {number} cpuFrequency CPU frequency in MHz
 * @param {number} t The time duration in microseconds to convert
 */
function microsecsToCycles( cpuFrequency, t ) {
    return t*cpuFrequency;
}

/** @param {string[]} env */
function getEnvInfo( env ) {
    const queuesEnv = env.map( e => e.split("=") ).find( ([key, val]) => key === "SCONE_QUEUES" );
    if (queuesEnv === undefined) return null;
    const queues = queuesEnv[1];
    const ethreadsEnv = env.map( e => e.split("=") ).find( ([key, val]) => key === "SCONE_ETHREADS" );
    const ethreads = ethreadsEnv === undefined ? queues : ethreadsEnv[1];
    return {
        queues: Number.parseInt(queues),
        ethreads: Number.parseInt(ethreads)
    }
}

/**
 * 
 * @param {import("./types").RuntimeObject} runtime 
 * @param {string[]} env 
 * @param {string} name
 */
function getRuntimeName( runtime, env, name, fullName = false ) {
    if (typeof name === "string") return name;
    if (!runtime.id.includes("scone") || !fullName) return runtime.name;
    if (env == null) {
        console.warn("Env array missing!");
        return;
    }
    const envInfo = getEnvInfo(env);
    return `${runtime.name}, ${envInfo.queues}Q ${envInfo.ethreads}E`;
}

/**
 * @param {string} content 
 * @param {[string, string][]} replacer 
 */
function replaceStrings( content, replacer ) {
    replacer.forEach( ([id, symbol]) => content = content.replace(new RegExp("\\$\\$"+id+"\\$\\$", "g"), symbol) )
    return content;
}

/**
 * @param {import("./types").PlotObject} figure 
 * @param {string} filepath 
 * @param {import("./types").PlotConfigProcessedObject} config
 */
async function createPlot(figure, filepath, config = null) {

    if (fs.existsSync(filepath)) return;

    // add config
    if (config !== null) {
        if (figure.layout.legend == null) figure.layout.legend = {};
        figure.layout.legend.xanchor = config.xAnchorLegend || "auto";
        figure.layout.legend.yanchor = config.yAnchorLegend || "auto";
        if (figure.layout.legend.x == null) figure.layout.legend.x = config.xLegend;
        if (figure.layout.legend.y == null) figure.layout.legend.y = config.yLegend;
        if (figure.layout.xaxis == null) figure.layout.xaxis = {};
        figure.layout.xaxis.range = config.xRange;
        if (figure.layout.yaxis == null) figure.layout.yaxis = {};
        figure.layout.yaxis.range = config.yRange;
        if (!figure.layout.shapes) figure.layout.shapes = config.shapes;
        if (!figure.layout.annotations) figure.layout.annotations = config.annotations;
        figure.width = config.width;
        figure.height = config.height;

        if (figure.layout.font == null) figure.layout.font = {};
        figure.layout.font.size = 16;
        if (["pdf", "svg"].some( e => filepath.endsWith("."+e) )) figure.layout.title = "";
        if (figure.layout.margin == null) figure.layout.margin = config.margin || {};
        if (!figure.layout.margin.t) figure.layout.margin.t = figure.layout.title ? 40 : 0;

        /*if (filepath.endsWith(".pdf")) {
            if (!figure.layout.margin.b) figure.layout.margin.b = 50;
            if (!figure.layout.margin.l) figure.layout.margin.l = 50;
            if (!figure.layout.margin.r) figure.layout.margin.r = 15;
        }*/
    }
    const replacer = figure.replacer;
    delete figure.replacer;

    try {
        /** @type {import("http").IncomingMessage} */
        var imgStream = await new Promise((resolve, reject) =>
            plotly.getImage(
                figure,
                {
                    format: path.extname(filepath).replace(".", ""),
                    width: figure.width || 1000,
                    height: figure.height || 1000
                },
                (err, msg) => err ? reject([err, msg]) : resolve(msg)
            )
        );

    } catch(e) {
        console.error("Could not create plot:", e);
        return;
    }

    // write to fs
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    if (path.extname(filepath) === ".svg" && Array.isArray(replacer)) {
        let content = "";
        await new Promise( (resolve, reject) => {
            imgStream.on("data", s => content+=s);
            imgStream.on("end", resolve);
            imgStream.on("close", resolve);
            imgStream.on("error", reject);
        });
        fs.writeFileSync(filepath, replaceStrings(content, replacer));
    } else {
        const fileStream = fs.createWriteStream(filepath);
        await new Promise((resolve, reject) => pipeline(imgStream, fileStream, err => err ? reject(err) : resolve()));
    }
    console.log(`Created plot ${path.basename(filepath)}`);
    
    // copy to thesis assets
    if (FILES_TO_MOVE.has(filepath)) {
        console.log(`Copying plot ${path.basename(filepath)}`)
        const dest = FILES_TO_MOVE.get(filepath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(filepath, dest);
    }

}

/**
 * Writes a file "type.meta.txt" in the given directory with
 * the given content
 * @param {string} directory 
 * @param {import("./types").PlotType} type
 * @param {string} content 
 */
function writeMetadataFile( directory, type, content = undefined ) {
    if (NO_METADATA) return;
    const filepath = path.join(DATA_DIR, directory, type.toLowerCase()+".meta.txt");
    if (typeof content !== "string") {
        fs.rmSync(filepath, { force: true });
    } else {
        fs.writeFileSync(filepath, content+"\n", { flag: "a" });
    }
}

/** @param {number[]} array */
function sum( array ) {
    return array.reduce( (sum, v) => sum + v, 0 );
}

/** @param {number[]} array */
function average( array ) {
    return sum(array) / array.length;
}

/** @param {number[]} array */
function median( array ) {
    if (array.length === 0) return NaN;
    array = array.slice().sort();
    if (array.length % 2 === 1) return array[Math.floor(array.length/2)];
    return average( array.slice(array.length/2-1, array.length/2+1) );
}

/** @param {number[]} array */
function min( array ) { return Math.min(...array); }

/** @param {number[]} array */
function max( array ) { return Math.max(...array); }

async function main() {

    // plot all custom plots
    glob
        .sync("**/plots.js", { cwd: DATA_DIR, strict: true, nodir: true })
        .forEach( f => {
            for (const [filepath, plot] of Object.entries(require(path.join(DATA_DIR, f)))) {
                for (const ext of PLOT_FILETYPES) createPlot(plot, path.join(PLOT_DIR, path.parse(f).dir, filepath+ext));
            }
        });
    
    // plots with config files
    for (const [directory, config] of PLOT_CONFIG_FILES) {
        console.log(`Plotting directory ${directory} with plot type ${config.type}`);
        writeMetadataFile(directory, config.type);

        config.files.sort( ([ra, ca], [rb, cb]) => {
            if (ra.index !== rb.index) return ra.index-rb.index;
            if (ca.environmentVariables == null) return 1;
            if (cb.environmentVariables == null) return -1;
            const envInfoA = getEnvInfo(ca.environmentVariables);
            const envInfoB = getEnvInfo(cb.environmentVariables);
            if (envInfoA.queues !== envInfoB.queues) return envInfoA.queues-envInfoB.queues;
            return envInfoA.ethreads-envInfoB.ethreads;
        });

        switch (config.type) {
            case "PARAMETER-TEST":
                {

                    /** @type {import("plotly.js").Data[]} */ const frequencyLinePlot = [];
                    /** @type {import("plotly.js").Data[]} */ const efficiencyLinePlot = [];
                    /** @type {import("plotly.js").Data[]} */ const cpuTimeLinePlot = [];
                    /** @type {import("plotly.js").Data[]} */ const utilizationLinePlot = [];
                    const allSSpins = new Set( config.files.map(([r, b]) => Number.parseInt(getEnvironmentVariableFromString(b.environmentVariables, "SCONE_SSPINS"))) )
                    const allSSleeps = new Set( config.files.map(([r, b]) => Number.parseInt(getEnvironmentVariableFromString(b.environmentVariables, "SCONE_SSLEEP"))) )
                    for (const [runtime, benchmark] of config.files) {
                        if (benchmark.type !== "FREQUENCY-BENCHMARK" || !runtime.id.startsWith("scone")) continue;
                        const sspins = Number.parseInt(getEnvironmentVariableFromString(benchmark.environmentVariables, "SCONE_SSPINS"));
                        const ssleep = Number.parseInt(getEnvironmentVariableFromString(benchmark.environmentVariables, "SCONE_SSLEEP"));
                        if (isNaN(sspins) || isNaN(ssleep)) {
                            console.error("Could not find the environment settings for SSPINS or SSLEEP! Cannot create plot!");
                            break;
                        }
                        const benchmarksSorted = benchmark.benchmarks.slice().sort((a, b) => a.numExecutions / (a.fullDuration / 1e6) - b.numExecutions / (b.fullDuration / 1e6));

                        const options = {
                            mode: "lines",
                            line: {
                                dash: benchmark.dash,
                                width: benchmark.lineWidth
                            },
                            opacity: benchmark.opacity,
                            name: (allSSleeps.size === 1 ? "" : ssleep) + (allSSleeps.size !== 1 && allSSpins.size !== 1 ? ", " : "") + (allSSpins.size === 1 ? "" : sspins)
                        };

                        if (frequencyLinePlot.length === 0) {
                            frequencyLinePlot.push({
                                x: benchmark.benchmarks.map(b => b.targetFrequency),
                                y: benchmark.benchmarks.map(b => b.targetFrequency),
                                name: `Target Throughput`,
                                mode: "lines",
                                line: {
                                    dash: "longdash",
                                    width: benchmark.lineWidth
                                },
                                opacity: benchmark.opacity
                            });
                        }
                        frequencyLinePlot.push(Object.assign({
                            x: benchmark.benchmarks.map(b => b.targetFrequency),
                            y: benchmark.benchmarks.map(b => b.numExecutions / (b.fullDuration / 1e6))
                        }, options));
                        efficiencyLinePlot.push(Object.assign({
                            x: benchmarksSorted.map(b => b.numExecutions / (b.fullDuration / 1e6)),
                            y: benchmarksSorted.map(b => b.fullDuration / (b.fullCpuTime / b.numThreads) * 100)
                        }, options));
                        cpuTimeLinePlot.push(Object.assign({
                            x: benchmarksSorted.map(b => b.numExecutions / (b.fullDuration / 1e6)),
                            y: benchmarksSorted.map(b => b.fullCpuTime / 1e6)
                        }, options));
                        utilizationLinePlot.push(Object.assign({
                            x: benchmarksSorted.map(b => b.numExecutions / (b.fullDuration / 1e6)),
                            y: benchmarksSorted.map(b => b.fullCpuTime / b.fullDuration * 100 - (config.normalize ? 100 : 0)),
                        }, options));

                    }

                    // create line plots
                    for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-frequency-line" + ext))) {
                        await createPlot(
                            {
                                data: frequencyLinePlot,
                                layout: {
                                    title: `<b>Maximum Syscall Throughput at increasing single-threaded Workload and different SCONE Parameters</b>`,
                                    xaxis: {
                                        title: "<b>Target Workload</b> [req/s]"
                                    },
                                    yaxis: {
                                        title: "<b>Throughput</b> [req/s]"
                                    },
                                    legend: {
                                        x: 0,
                                        y: 1
                                    }
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }

                    // create line plots
                    for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-cpu-utilization-line" + ext))) {
                        await createPlot(
                            {
                                data: utilizationLinePlot,
                                layout: {
                                    title: `<b>CPU Utilization at increasing single-threaded Workload and different SCONE Parameters</b>`,
                                    xaxis: {
                                        title: "<b>Throughput</b> [req/s]"
                                    },
                                    yaxis: {
                                        title: `<b>CPU Utilization${config.normalize ? " (normalized)" : ""}</b> [%]`
                                    }
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;

            case "CPU-ACCUMULATE":
                {
                    /** @type {import("plotly.js").Data[]} */ const accumLinePlot = [];
                    let frequency = NaN;
                    for (const [runtime, benchmark] of config.files) {
                        if (benchmark.type !== "FREQUENCY-BENCHMARK") continue;
                        if (benchmark.benchmarks[0].targetFrequency !== benchmark.benchmarks[benchmark.benchmarks.length-1].targetFrequency) throw new Error("Frequency is varying. Cannot plot this!");
                        frequency = benchmark.benchmarks[0].targetFrequency;

                        // runtimes
                        let sum = 0;
                        const name = getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name);
                        const fullName = getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name, true);
                        accumLinePlot.push({
                            y: benchmark.benchmarks.map( b => (sum += (b.fullCpuTime*(1e6/b.fullDuration))/1e6) ),
                            name: name,
                            type: "line",
                            line: {
                                color: getColor(benchmark, runtime),
                                dash: benchmark.dash
                            },
                            opacity: benchmark.opacity
                        });
                        writeMetadataFile(directory, config.type, `\nMin CPU Utilization of ${fullName}: ${min( benchmark.benchmarks.map( b => ((b.fullCpuTime*(1e6/b.fullDuration))/1e6) * 100) )}%`);
                        writeMetadataFile(directory, config.type, `Max CPU Utilization of ${fullName}: ${max( benchmark.benchmarks.map( b => ((b.fullCpuTime*(1e6/b.fullDuration))/1e6) * 100) )}%`);
                        writeMetadataFile(directory, config.type, `Average CPU Utilization of ${fullName}: ${(sum/benchmark.benchmarks.length)*100}%`);
                        writeMetadataFile(directory, config.type, `Median CPU Utilization of ${fullName}: ${median( benchmark.benchmarks.map( b => ((b.fullCpuTime*(1e6/b.fullDuration))/1e6) * 100) )}%`);
                    }

                    // CPU accumulated time plot
                    if (accumLinePlot.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-cpu-accumulate-line" + ext))) {
                        await createPlot(
                            {
                                data: accumLinePlot,
                                layout: {
                                    title: `<b>Accumulated CPU Time at ${frequency} Request/s</b>`,
                                    xaxis: {
                                        title: "<b>Time</b> [s]"
                                    },
                                    yaxis: {
                                        title: "<b>Accumulated CPU Time</b> [s]"
                                    }
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;
            
            case "THROUGHPUT-BOX":
                {
                    /** @type {import("plotly.js").Data[]} */ const data = [];
                    let threads = NaN;
                    config.files.sort( ([ra, ca], [rb, cb]) => {
                        if (ra.index !== rb.index) return ra.index-rb.index;
                        if (ca.environmentVariables == null) return 1;
                        if (cb.environmentVariables == null) return -1;
                        const envInfoA = getEnvInfo(ca.environmentVariables);
                        const envInfoB = getEnvInfo(cb.environmentVariables);
                        if (envInfoA.queues !== envInfoB.queues) return envInfoB.queues-envInfoA.queues;
                        return envInfoB.ethreads-envInfoA.ethreads;
                    });

                    for (const [runtime, benchmark] of config.files) {
                        if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                        const envInfo = getEnvInfo(benchmark.environmentVariables);
                        if (isNaN(threads)) threads = benchmark.numThreads;
                        else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");

                        // runtimes
                        data.push({
                            y: benchmark.runtimesMicroseconds.map(t => (1e6/t)*threads),
                            name: (!runtime.id.includes("scone") || (envInfo.ethreads === 8 && envInfo.queues === 8)) ? getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name) : `(${envInfo.queues}Q ${envInfo.ethreads}E)`+" ".repeat(runtime.index),
                            type: "box",
                            line: {
                                color: getColor(benchmark, runtime),
                                dash: benchmark.dash
                            },
                        });
                    }

                    // CPU accumulated time plot
                    if (data.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"throughput-box") + ext))) {
                        await createPlot(
                            {
                                data: data,
                                layout: {
                                    title: `<b>Throughput for High Workload</b>`,
                                    yaxis: {
                                        title: "<b>Throughput</b> [req/s]"
                                    },
                                    showlegend: false
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;
            
            case "UTILIZATION-BOX":
                {
                    /** @type {import("plotly.js").Data[]} */ const data = [];
                    config.files.sort( ([ra, ca], [rb, cb]) => {
                        if (ra.index !== rb.index) return ra.index-rb.index;
                        if (ca.environmentVariables == null) return 1;
                        if (cb.environmentVariables == null) return -1;
                        const envInfoA = getEnvInfo(ca.environmentVariables);
                        const envInfoB = getEnvInfo(cb.environmentVariables);
                        if (envInfoA.queues !== envInfoB.queues) return envInfoB.queues-envInfoA.queues;
                        return envInfoB.ethreads-envInfoA.ethreads;
                    });

                    for (const [runtime, benchmark] of config.files) {
                        if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                        const envInfo = getEnvInfo(benchmark.environmentVariables);

                        // runtimes
                        data.push({
                            y: benchmark.cpuTimesMicroseconds.map( (c, i) => c/benchmark.runtimesMicroseconds[i]*100 ),
                            name: (!runtime.id.includes("scone") || (envInfo.ethreads === 8 && envInfo.queues === 8)) ? getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name) : `(${envInfo.queues}Q ${envInfo.ethreads}E)`+" ".repeat(runtime.index),
                            type: "box",
                            line: {
                                color: getColor(benchmark, runtime),
                                dash: benchmark.dash
                            },
                        });
                    }

                    // CPU accumulated time plot
                    if (data.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"cpu-utilization-box") + ext))) {
                        await createPlot(
                            {
                                data: data,
                                layout: {
                                    title: `<b>CPU Utilization for high Throughput</b>`,
                                    yaxis: {
                                        title: "<b>CPU Utilization</b> [%]"
                                    },
                                    showlegend: false
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;

            case "UTILIZATION-AT-FREQUENCY-BOX":
                {
                    /** @type {import("plotly.js").Data[]} */ const data = [];
                    let frequency = NaN;
                    config.files.sort( ([ra, ca], [rb, cb]) => {
                        if (ra.index !== rb.index) return ra.index-rb.index;
                        if (ca.environmentVariables == null) return 1;
                        if (cb.environmentVariables == null) return -1;
                        const envInfoA = getEnvInfo(ca.environmentVariables);
                        const envInfoB = getEnvInfo(cb.environmentVariables);
                        if (envInfoA.queues !== envInfoB.queues) return envInfoB.queues-envInfoA.queues;
                        return envInfoB.ethreads-envInfoA.ethreads;
                    });

                    const runtimes = new Set();
                    for (const [runtime, benchmark] of config.files) {
                        if (benchmark.type !== "FREQUENCY-BENCHMARK") continue;
                        if (benchmark.benchmarks[0].targetFrequency !== benchmark.benchmarks[benchmark.benchmarks.length-1].targetFrequency) throw new Error("Frequency is varying. Cannot plot this!");
                        frequency = benchmark.benchmarks[0].targetFrequency;
                        const envInfo = getEnvInfo(benchmark.environmentVariables);

                        // runtimes
                        data.push({
                            y: benchmark.benchmarks.map( b => b.fullCpuTime/b.fullDuration*100 ),
                            name: !runtimes.has(runtime.id) ? getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name) : `(${envInfo.queues}Q ${envInfo.ethreads}E)`+" ".repeat(runtime.index),
                            type: "box",
                            line: {
                                color: getColor(benchmark, runtime),
                                dash: benchmark.dash
                            },
                        });
                        runtimes.add(runtime.id);
                    }

                    // CPU accumulated time plot
                    if (data.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"cpu-utilization-box") + ext))) {
                        await createPlot(
                            {
                                data: data,
                                layout: {
                                    title: `<b>CPU Utilization at ${frequency} Request/s</b>`,
                                    yaxis: {
                                        title: "<b>CPU Utilization</b> [%]"
                                    },
                                    showlegend: false
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;

            case "UTILIZATION-AT-FREQUENCY":
                {
                    /** @type {import("plotly.js").Data[]} */ const cpuUtilizationLinePlot = [];
                    let frequency = NaN;
                    for (const [runtime, benchmark] of config.files) {
                        if (benchmark.type !== "FREQUENCY-BENCHMARK") continue;
                        if (benchmark.benchmarks[0].targetFrequency !== benchmark.benchmarks[benchmark.benchmarks.length-1].targetFrequency) throw new Error("Frequency is varying. Cannot plot this!");
                        frequency = benchmark.benchmarks[0].targetFrequency;
                        const envInfo = getEnvInfo(benchmark.environmentVariables);

                        // runtimes
                        cpuUtilizationLinePlot.push({
                            y: benchmark.benchmarks.map( b => b.fullCpuTime/b.fullDuration*100 ),
                            name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                            type: "line",
                            line: {
                                color: getColor(benchmark, runtime),
                                dash: benchmark.dash
                            },
                            opacity: benchmark.opacity,
                            showlegend: !runtime.id.includes("scone") || envInfo.ethreads === 8 && envInfo.queues === 8,
                            legendgroup: "runtimes"
                        });
                    }

                    // CPU accumulated time plot
                    if (cpuUtilizationLinePlot.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"cpu-utilization-line") + ext))) {
                        await createPlot(
                            {
                                data: cpuUtilizationLinePlot.concat([{ mode: "lines", line: { color: "#000000" }, name: "8Q 8E", x: [2], y: [0], showlegend: true, legendgroup: "setup" }, { mode: "lines", line: { color: "#000000", dash: "dash" }, name: "1Q 1E", x: [2], y: [0], showlegend: true, legendgroup: "setup" }]),
                                layout: {
                                    title: `<b>CPU Utilization at ${frequency} Request/s</b>`,
                                    xaxis: {
                                        title: "<b>Sample</b>"
                                    },
                                    yaxis: {
                                        title: "<b>CPU Utilization</b> [%]"
                                    },
                                    legend: {
                                        orientation: "h"
                                    }
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;

            case "UTILIZATION-THROUGHPUT":
            case "UTILIZATION-THROUGHPUT-UNSORTED":
                {
                    /** @type {import("plotly.js").Data[]} */ const utilizationData = [];
                    /** @type {import("plotly.js").Data[]} */ const utilizationUnsortedData = [];
                    let program = "";
                    const queueConfig = new Set();

                    for (const [runtime, benchmark] of config.files) {
                        const envInfo = getEnvInfo(benchmark.environmentVariables);
                        const fullName = getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name, true);
                        if (envInfo) queueConfig.add(envInfo.queues.toString()+envInfo.ethreads.toString());
                        const showlegend = !runtime.id.includes("scone") || envInfo.ethreads === 8 && envInfo.queues === 8;
                        let x = [];
                        let y = [];
                        if (benchmark.type === "FREQUENCY-BENCHMARK") {
                            const benchmarksSorted = benchmark.benchmarks.slice().sort((a, b) => a.numExecutions / (a.fullDuration / 1e6) - b.numExecutions / (b.fullDuration / 1e6));
                            x = benchmark.benchmarks.map(b => b.numExecutions / (b.fullDuration / 1e6));
                            y = benchmark.benchmarks.map(b => b.fullCpuTime / b.fullDuration * 100);
                            if (config.normalize === true) y = y.map( v => v-100 );
                            writeMetadataFile(directory, config.type, `Max. Throughput of ${fullName}: ${max(x)}req/s`);
                            writeMetadataFile(directory, config.type, `Max. CPU Utilization of ${fullName}: ${max(y)}%\n`);

                            if (config.type === "UTILIZATION-THROUGHPUT") utilizationData.push({
                                x: benchmarksSorted.map(b => b.numExecutions / (b.fullDuration / 1e6)),
                                y: benchmarksSorted.map(b => b.fullCpuTime / b.fullDuration * 100),
                                name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: benchmark.dash,
                                    width: benchmark.lineWidth
                                },
                                opacity: benchmark.opacity,
                                showlegend,
                                legendgroup: "runtime"
                            });
                        } else if (benchmark.type === "LATENCY-BENCHMARK") {
                            program = benchmark.program;
                            x = benchmark.benchmarks.map(b => b.throughput);
                            y = benchmark.benchmarks.map(b => b.server_cpu);
                        } else {
                            continue;
                        }
                        
                        if (config.type === "UTILIZATION-THROUGHPUT-UNSORTED") {
                            utilizationUnsortedData.push({
                                x: x,
                                y: y,
                                name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: benchmark.dash,
                                    width: benchmark.lineWidth
                                },
                                opacity: benchmark.opacity,
                                showlegend,
                                legendgroup: "runtime"
                            });
                        }

                    }

                    // create line plots
                    if (utilizationData.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"utilization") + ext))) {
                        await createPlot(
                            {
                                data: utilizationData.concat(Array.from(queueConfig).map( c => ({ mode: "lines", line: { color: "#000000", dash: getDashConfig(c) }, name: `${c[0]}Q ${c[1]}E`, x: [0], y: [0], showlegend: true, legendgroup: "setup" }) )),
                                layout: {
                                    title: `<b>${config.normalize?"normalized ":""}CPU Utilization at increasing single-threaded Workload (sorted by Throughput)</b>`,
                                    xaxis: {
                                        title: "<b>Throughput</b> [req/s]"
                                    },
                                    yaxis: {
                                        title: `<b>${config.normalize ? "normalized ": ""}CPU Utilization</b> [%]`
                                    }
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }

                    // create line plots
                    if (utilizationUnsortedData.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"utilization-unsorted") + ext))) {
                        await createPlot(
                            {
                                data: utilizationUnsortedData.concat([{ mode: "lines", line: { color: "#000000" }, name: "8Q 8E", x: [2], y: [0], showlegend: true, legendgroup: "setup" }, { mode: "lines", line: { color: "#000000", dash: "dash" }, name: "1Q 1E", x: [2], y: [0], showlegend: true, legendgroup: "setup" }]),
                                layout: {
                                    title: `<b>${config.normalize?"normalized ":""}CPU Utilization ${program === "" ? "at increasing single-threaded Workload" : "for " + program}</b>`,
                                    xaxis: {
                                        title: "<b>Throughput</b> [req/s]"
                                    },
                                    yaxis: {
                                        title: `<b>${config.normalize ? "normalized ": ""}CPU Utilization</b> [%]`
                                    },
                                    legend: {
                                        orientation: "h"
                                    }
                                }
                            },
                            plotFilepath,
                            config
                        );
                    }
                }
                break;

                case "UTILIZATION-THROUGHPUT-MEDIAN":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];
                        const SYMBOLS = [[1, 1, "triangle"], [1, 2, "hourglass"], [2, 2, "square"], [1, 8, "asterisk"], [8, 8, "circle"]];
                        
                        let threads = NaN;
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
                            if (benchmark.cpuTimesMicroseconds.length !== benchmark.runtimesMicroseconds.length) throw new RangeError("Runtimes array length does not match CPU times!");
                            let symbol = "circle";
                            if (runtime.id.includes("scone")) {
                                const info = getEnvInfo(benchmark.environmentVariables);
                                symbol = SYMBOLS.find( ([q, e]) => info.queues === q && info.ethreads === e )[2];
                            }

                            data.push({
                                x: [median(benchmark.runtimesMicroseconds.map( t => (1e6/t)*threads) )],
                                y: [median(benchmark.runtimesMicroseconds.map( (t, i) => benchmark.cpuTimesMicroseconds[i] / t * 100) )],
                                name: runtime.name,
                                mode: "markers",
                                type: "scatter",
                                marker: {
                                    color: getColor(benchmark, runtime),
                                    symbol: symbol,
                                    opacity: 0.6
                                }
                            });
    
                        }

                        // create line plots
                        for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-utilization-throughput-median" + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        //title: `<b>Median Throughput vs CPU Utilization for ${threads} Lthreads</b>`,
                                        xaxis: {
                                            title: "<b>Throughput</b> [req/s]"
                                        },
                                        yaxis: {
                                            title: "<b>CPU Utilization</b> [%]",
                                            range: [0, 1600]
                                        },
                                        legend: {
                                            orientation: "h"
                                        }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                case "THROUGHPUT":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];

                        let threads = NaN;
                        let bufferSize = NaN;
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
                            if (benchmark.bufferSize && benchmark.bufferSize !== 1) bufferSize = benchmark.bufferSize;
    
                            const multiplier = isNaN(bufferSize) ? 1 : bufferSize/1e6;
                            data.push({
                                y: benchmark.runtimesMicroseconds.map(t => (1e6/t)*multiplier*threads),
                                name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: benchmark.dash
                                },
                                opacity: benchmark.opacity
                            });
    
                        }

                        // create line plots
                        for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-throughput" + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        title: `<b>Max. Throughput of ${isNaN(bufferSize) ? "SGX System Calls" : bufferSize+" Byte Writes in SGX"} using ${threads} Lthreads</b>`,
                                        xaxis: {
                                            title: "<b>Sample</b>"
                                        },
                                        yaxis: {
                                            title: `<b>Throughput</b> [${isNaN(bufferSize) ? "req" : "MB"}/s]`
                                        }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                case "THROUGHPUT-BAR":
                    {

                        let threads = NaN;
                        /** @type {Map<import("./types").RuntimeID, { x: number[], y: number[], runtime: import("./types").RuntimeObject }>} */
                        const dataMap = new Map();
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
    
                            const throughput = median(benchmark.runtimesMicroseconds.map(t => (1e6/t)*threads));
                            let info = null;
                            if (runtime.id.includes("scone")) info = getEnvInfo(benchmark.environmentVariables);
                            const group = info ? `${info.queues}Q${info.ethreads}E` : "Other"
                            if (!dataMap.has(runtime.id)) dataMap.set(runtime.id, { x: [], y: [], runtime });
                            dataMap.get(runtime.id).x.push(group);
                            dataMap.get(runtime.id).y.push(throughput);
                        }

                        /** @type {import("plotly.js").Data[]} */ const data = [];
                        for (const d of dataMap.values()) {
                            data.push({
                                type: "bar",
                                x: d.x,
                                y: d.y,
                                name: d.runtime.name,
                                marker: { color: d.runtime.color }
                            });
                        }

                        // create line plots
                        for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-throughput-bar" + ext))) {
                            await createPlot(
                                {
                                    data,
                                    layout: {
                                        title: `<b>Median SGX System Call Throughput for ${threads} Lthreads</b>`,
                                        xaxis: {
                                            title: "<b>Setup</b>"
                                        },
                                        yaxis: {
                                            title: `<b>Throughput</b> [req/s]`
                                        },
                                        barmode: "group",
                                        bargroupgap: 0,
                                        legend: {
                                            orientation: "h",
                                            xanchor: "right"
                                        }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                case "UTILIZATION":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];

                        let threads = NaN;
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
                            const envInfo = getEnvInfo(benchmark.environmentVariables);

                            data.push({
                                y: benchmark.cpuTimesMicroseconds.map((t, i) => benchmark.cpuTimesMicroseconds[i]/benchmark.runtimesMicroseconds[i]*100),
                                name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: benchmark.dash
                                },
                                opacity: benchmark.opacity,
                                showlegend: envInfo === null || envInfo.ethreads === 8 && envInfo.queues === 8
                            });
                        }

                        if (data.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-utilization" + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        title: `<b>CPU Utilization at High Throughput using ${threads} Lthreads</b>`,
                                        xaxis: {
                                            title: "<b>Sample</b>"
                                        },
                                        yaxis: {
                                            title: "<b>CPU Utilization</b> [%]"
                                        }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                case "DURATION":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];

                        let threads = NaN;
                        let bufferSize = NaN;
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
                            if (benchmark.bufferSize && benchmark.bufferSize !== 1) bufferSize = benchmark.bufferSize;

                            // runtimes
                            const name = getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name);
                            data.push({
                                y: benchmark.runtimesMicroseconds,
                                name: `Runtime (${name})`,
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: benchmark.dash
                                }
                            });

                            // CPU times
                            data.push({
                                y: benchmark.cpuTimesMicroseconds.map(t => t / benchmark.numThreads),
                                name: `CPU-Time (${name})`,
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: "dashdot",
                                    dash: benchmark.dash || "dash"
                                },
                                opacity: benchmark.opacity
                            });
                            const longName = getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name, true);
                            writeMetadataFile(directory, config.type, `Average syscall duration of ${longName}: ${average(benchmark.runtimesMicroseconds)}µs`);
                            writeMetadataFile(directory, config.type, `Median syscall duration of ${longName}: ${median(benchmark.runtimesMicroseconds)}µs`);
                            writeMetadataFile(directory, config.type, `Average syscall CPU time of ${longName}: ${average(benchmark.cpuTimesMicroseconds.map(t => t / benchmark.numThreads))}µs`);
                            writeMetadataFile(directory, config.type, `Median syscall CPU time of ${longName}: ${median(benchmark.cpuTimesMicroseconds.map(t => t / benchmark.numThreads))}µs`);
                            writeMetadataFile(directory, config.type, `Average syscall CPU utilization of ${longName}: ${average(benchmark.cpuTimesMicroseconds.map((t,i) => t/benchmark.runtimesMicroseconds[i]*100))}%`);
                            writeMetadataFile(directory, config.type, `Median syscall CPU utilization of ${longName}: ${median(benchmark.cpuTimesMicroseconds.map((t,i) => t/benchmark.runtimesMicroseconds[i]*100))}%\n`);
                        }

                        const maxDuration = data.reduce( (max, d) => Math.max(max, Math.max(...d.y)), 0 );
                        const minDuration = data.reduce( (min, d) => Math.min(min, Math.min(...d.y)), Number.POSITIVE_INFINITY );
                        for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-duration" + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        title: `<b>Average Duration of a single ${isNaN(bufferSize) ? "SGX System Call" : bufferSize+" Byte Write in SGX"} using ${threads} Lthreads</b>`,
                                        xaxis: {
                                            title: "<b>Sample</b>"
                                        },
                                        yaxis: {
                                            title: "<b>Duration</b> [us]",
                                            //range: [0, maxDuration*1.05]
                                        }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;
                
                case "DURATION-BOX":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];

                        let threads = NaN;
                        let bufferSize = NaN;
                        let i = 0;
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
                            if (benchmark.bufferSize && benchmark.bufferSize !== 1) bufferSize = benchmark.bufferSize;

                            // runtimes
                            data.push({
                                y: benchmark.runtimesMicroseconds,
                                name: `${runtime.name}`,
                                type: "box",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    width: 1
                                },
                                marker: {
                                    width: 2
                                }
                            });

                            // CPU times
                            data.push({
                                y: benchmark.cpuTimesMicroseconds.map(t => t / benchmark.numThreads),
                                name: " ".repeat(i),
                                type: "box",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    width: 1
                                },
                                marker: {
                                    width: 2
                                },
                                showlegend: false,
                                opacity: 0.6,
                            });
                            i++;
                        }

                        const maxDuration = data.reduce( (max, d) => Math.max(max, Math.max(...d.y)), 0 );
                        const minDuration = data.reduce( (min, d) => Math.min(min, Math.min(...d.y)), Number.POSITIVE_INFINITY );
                        for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-duration-box" + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        title: `<b>Average Duration of a single ${isNaN(bufferSize) ? "SGX System Call" : bufferSize+" Byte Write in SGX"} using ${threads} Lthreads</b>`,
                                        yaxis: {
                                            title: "<b>Duration</b> [us]",
                                            range: [0, maxDuration*1.05]
                                        },
                                        legend: {
                                            x: 1,
                                            y: 0.5,
                                            xanchor: "left"
                                        },
                                        showlegend: false
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                case "EFFICIENCY-BOX":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];
                        config.files.sort( ([ra, ca], [rb, cb]) => {
                            if (ra.index !== rb.index) return ra.index-rb.index;
                            if (ca.environmentVariables == null) return 1;
                            if (cb.environmentVariables == null) return -1;
                            const envInfoA = getEnvInfo(ca.environmentVariables);
                            const envInfoB = getEnvInfo(cb.environmentVariables);
                            if (envInfoA.queues !== envInfoB.queues) return envInfoB.queues-envInfoA.queues;
                            return envInfoB.ethreads-envInfoA.ethreads;
                        });

                        let threads = NaN;
                        let bufferSize = NaN;
                        let i = 0;
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "TROUGHPUT-BENCHMARK") continue;
                            if (isNaN(threads)) threads = benchmark.numThreads;
                            else if (threads !== benchmark.numThreads) throw new Error("Trying to compare benchmarks with different thread configuration!");
                            if (benchmark.bufferSize && benchmark.bufferSize !== 1) bufferSize = benchmark.bufferSize;
                            const envInfo = getEnvInfo(benchmark.environmentVariables);

                            // CPU times
                            data.push({
                                y: benchmark.cpuTimesMicroseconds.map(t => t / benchmark.numThreads),
                                name: (!runtime.id.includes("scone") || (envInfo.ethreads === 8 && envInfo.queues === 8)) ? getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name) : `(${envInfo.queues}Q ${envInfo.ethreads}E)`+" ".repeat(runtime.index),
                                type: "box",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    width: 1
                                },
                                marker: {
                                    width: 2
                                }
                            });
                            i++;
                        }

                        const maxDuration = data.reduce( (max, d) => Math.max(max, Math.max(...d.y)), 0 );
                        const minDuration = data.reduce( (min, d) => Math.min(min, Math.min(...d.y)), Number.POSITIVE_INFINITY );
                        for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"efficiency-box") + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        title: `<b>Average CPU Time per ${isNaN(bufferSize) ? "SGX System Call" : bufferSize+" Byte Write in SGX"} using ${threads} Lthreads</b>`,
                                        yaxis: {
                                            title: "<b>CPU Time per Syscall</b> [us]"
                                        },
                                        legend: {
                                            x: 1,
                                            y: 0.5,
                                            xanchor: "left"
                                        },
                                        showlegend: false
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                case "FREQUENCY":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "FREQUENCY-BENCHMARK") continue;
    
                            if (data.length === 0) {
                                data.push({
                                    x: benchmark.benchmarks.map((b, i) => i + 1),
                                    y: benchmark.benchmarks.map(b => b.targetFrequency),
                                    name: `Target Throughput`,
                                    mode: "lines",
                                    line: {
                                        dash: "longdash"
                                    },
                                    opacity: benchmark.opacity
                                });
                            }
                            data.push({
                                x: benchmark.benchmarks.map((b, i) => i + 1),
                                y: benchmark.benchmarks.map(b => b.numExecutions / (b.fullDuration / 1e6)),
                                name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                                mode: "lines",
                                line: {
                                    dash: benchmark.dash
                                },
                                opacity: benchmark.opacity
                            });
    
                        }
    
                        // create line plots
                        if (data.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-frequency" + ext))) {
                            await createPlot(
                                {
                                    data: data,
                                    layout: {
                                        title: `<b>Maximum Throughput of SGX System Calls</b>`,
                                        xaxis: {
                                            title: "<b>Sample</b>"
                                        },
                                        yaxis: {
                                            title: "<b>Throughput</b> [req/s]"
                                        }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

                    case "LATENCY-THROUGHPUT":
                    {
                        /** @type {import("plotly.js").Data[]} */ const data = [];
                        const isLowLatency = Array.isArray(config.yRange) && config.yRange.every( r => r < 1 );
                        if (isLowLatency && Array.isArray(config.yRange)) config.yRange = config.yRange.map( r => r*1e3 );
                        const queueConfig = new Set();
    
                        for (const [runtime, benchmark] of config.files) {
                            if (benchmark.type !== "LATENCY-BENCHMARK") continue;
                            const envInfo = getEnvInfo(benchmark.environmentVariables);
                            if (envInfo) queueConfig.add(envInfo.queues.toString()+envInfo.ethreads.toString());
                            
                            data.push({
                                x: benchmark.benchmarks.map(b => b.throughput),
                                y: benchmark.benchmarks.map(b => b.avg_latency/(isLowLatency ? 1e3 : 1e6)),
                                name: getRuntimeName(runtime, benchmark.environmentVariables, benchmark.name),
                                mode: "lines",
                                line: {
                                    color: getColor(benchmark, runtime),
                                    dash: benchmark.dash
                                },
                                opacity: benchmark.opacity,
                                legendgroup: "runtime",
                                showlegend: !envInfo || (envInfo.queues === 8 && envInfo.ethreads === 8)
                            });
    
                        }
    
                        // create line plots
                        if (data.length !== 0) for (const plotFilepath of PLOT_FILETYPES.map(ext => path.join(PLOT_DIR, directory + "-" + (config.name||"latency-throughput") + ext))) {
                            await createPlot(
                                {
                                    data: data.concat(Array.from(queueConfig).map( c => ({ mode: "lines", line: { color: "#000000", dash: getDashConfig(c) }, name: `${c[0]}Q ${c[1]}E`, x: [0], y: [0], showlegend: true, legendgroup: "setup" }) )),
                                    layout: {
                                        xaxis: {
                                            title: "<b>Throughput</b> [req/s]"
                                        },
                                        yaxis: {
                                            title: `<b>Latency</b> [${isLowLatency ? "ms" : "s"}]`
                                        },
                                        legend: { orientation: "v" }
                                    }
                                },
                                plotFilepath,
                                config
                            );
                        }
                    }
                    break;

            default:
                console.warn(`Received unkown plot configuration type: ${config.type}`);
                break;
        }
    }

}
setImmediate(() => main().catch(console.error));
