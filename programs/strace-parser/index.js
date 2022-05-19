"use strict";

/*
 * Parses several strace log files and collects important data. The logs are
 * exprected to be created with "strace -xx -ttt -ff -T -o /strace_output/strace.log"
 */

/** @typedef {{ count: number, min: number, max: number, average: number, median: number, sum: number }} SyscallInfo */

const fs = require("fs");
const path = require("path");

/** @type {Map<string, number[]>} */
const syscalls = new Map();

const PARSER = [
    {
        key: "timestamp",
        parser: s => Number.parseFloat
    },
    {
        key: "syscall",
        parser: s => {
            const r = /^([a-zA-Z0-9_]+)\(.*\).*$/.exec(s);
            if (r === null || r.length !== 2) throw new Error(`Invalid syscall: "${s}"`);
            return r[1];
        }
    },
    {
        key: "duration",
        parser: s => Number.parseFloat(s)
    }
];

/**
 * 
 * @param {string} line 
 */
function parseLine( line ) {
    const r = /^([0-9]+\.[0-9]+) (.+) <([0-9]+\.[0-9]+)>$/.exec(line);
    if (r === null || r.length !== 4) return console.warn(`Invalid format of line: "${line}"`);
    
    /** @type {{ timestamp: number, syscall: string, duration: number }} */
    const raw = {};
    PARSER.forEach( (p, i) => raw[p.key] = p.parser(r[i+1]) );

    if (!syscalls.has(raw.syscall)) syscalls.set(raw.syscall, []);
    syscalls.get(raw.syscall).push( raw.duration );
}


async function main() {
    if (process.argv.length < 3) {
        console.error("Usage: node . LOG_DIR [OUTPUT_FILE]\n");
        process.exit(1);
    }
    
    const directory = path.join(process.argv[2]);
    const outputFile = process.argv.length >= 4 ? path.join(process.argv[3]) : path.join(directory, "syscalls.csv");
    console.log(`Parsing directory "${directory}"...`);
    for (const filename of fs.readdirSync(directory)) {
        if (!/^strace\.log(\.[0-9]+)*$/.test(filename)) continue;
        console.log(`Parsing file "${filename}"...`);
        const stream = fs.createReadStream(path.join(directory, filename), { encoding: "utf8", autoClose: true });

        let buffer = "";
        stream.on("data", s => {
            for (let i = 0; i < s.length; i++) {
                const c = s.charAt(i);
                if (c === '\n') {
                    parseLine(buffer);
                    buffer = "";
                } else {
                    buffer += c;
                }
            }
        });

        await new Promise( (r) => stream.on("close", r) );
    }
    console.log("Done!\n");

    // write to file
    const stream = fs.createWriteStream(outputFile, { encoding: "utf8" });
    stream.write("syscall,count,duration_sum,duration_median,duration_avg,duration_min,duration_max\n");
    for (const [syscall, durations] of syscalls) {
        durations.sort();

        /** @type {SyscallInfo} */
        const info = {
            sum: durations.reduce( (sum, d) => sum+d, 0 ),
            count: durations.length,
            min: durations[0],
            max: durations[durations.length-1],
            median: durations.length % 2 === 0 ? (durations[durations.length/2-1]+durations[durations.length/2])/2 : durations[Math.floor(durations.length/2)]
        };
        info.average = info.sum / info.count;
        
        if (!stream.write([syscall, info.count, info.sum, info.median, info.average, info.min, info.max].join(",")+"\n")) await new Promise( r => stream.on("drain", r) );
    }
    await new Promise( (resolve, reject) => stream.close(err => err ? reject(err) : resolve()) );
}

// run
main();