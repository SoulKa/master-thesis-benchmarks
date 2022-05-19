
/**
 * Parses a string of format "123.0ms" or "12.3s" etc to a float
 * in microseconds
 * @param {string} s The duration string
 */
function parseDurationString( s ) {
    const r = /(^[0-9]+\.[0-9]{2})(ms|s)$/.exec(s);
    if (r === null || r.length !== 3) throw new TypeError(`The given string "${s}" is not a valid time duration string!`);
    const amount = Number.parseFloat(r[1]);
    const unit = r[2];

    let multiplier = 1;
    switch (unit) {
        case "s": multiplier = 1e6; break;
        case "ms": multiplier = 1e3; break;
        default: throw new Error(`Unkown time unit "${unit}"`);
    }
    if (isNaN(amount)) throw new Error(`Could not parse the given number "${r[1]}" to float!`);
    return amount*multiplier;
}

/** @type {{ [header: string]: (s: string) => any }} */
const LATENCY_CSV_PARSER = {
    datetime: s => new Date(s),
    avg_latency: parseDurationString,
    max_latency: parseDurationString,
    throughput: Number.parseFloat,
    wrk_threads: Number.parseInt,
    wrk_connections: Number.parseInt,
    wrk_rate: Number.parseInt,
    server_cpu: Number.parseInt,
    url: s => s,
    queues: Number.parseInt,
    dash: s => s
};

/**
 * Parses the given CSV string into a batch object
 * @param {string} csv The CSV to parse
 */
function parseCsv( csv ) {

    /** @type {import("./types").LatencyBatchDataObject} */
    const res = {
        benchmarks: [],
        type: "LATENCY-BENCHMARK",
        payload: "UNKNOWN"
    };

    /** @type {{ [header: string]: string[] }} */
    const raw = {};
    const lines = csv.split("\n").map( l => l.trim() ).filter( l => l !== "" );
    const headers = lines.shift().split(",").map( s => s.trim() );
    for (const header of headers) raw[header] = [];
    for (let li = 0; li < lines.length; li++) {
        try {
            const b = {};
            lines[li].split(",").forEach( (v, i) => raw[headers[i]][li] = v.trim() );
            Object.entries(LATENCY_CSV_PARSER).forEach( ([h, f]) => b[h] = raw[h] === undefined ? undefined : f(raw[h][li]) )
            res.benchmarks.push(b);
        } catch(e) {
            console.error(`Error while parsing line ${li+2} of CSV. Error was:`, e);
            throw new Error("Could not parse CSV file");
        }
    }

    // assemble
    res.payload = raw.payload[0];
    res.program = raw.url[0].includes("nginx") ? "NGINX" : raw.url[0].includes("vault") ? "Vault" : "UNKNOWN";
    return res;

}

module.exports = {
    parseCsv
}