declare type BatchDataObjectBase = {
    environmentVariables: string[];
    dash?: "solid"|"dot"|"dash"|"longdash"|"dashdot"|"longdashdot";
    color?: number|string;
    name?: string;
    opacity?: number;
    lineWidth?: number;
};

export type ThroughputBatchDataObject = {
    runtimesMicroseconds: number[];
    cpuTimesMicroseconds: number[];
    numThreads: number;
    numExecutions: number;
    type: "TROUGHPUT-BENCHMARK";
} & BatchDataObjectBase;

export type WriteBatchDataObject = ThroughputBatchDataObject & {
    bufferSize: number;
}

export type FrequencyBenchmarkDataObject = {
    numExecutions: number;
    numThreads: number;
    fullDuration: number;
    fullCpuTime: number;
    runtimeMean: number;
    runtimeMin: number;
    runtimeMax: number;
    runtimeMedian: number;
    targetFrequency: number;
};

export type FrequencyBatchDataObject = {
    benchmarks: FrequencyBenchmarkDataObject[];
    numThreads: number;
    type: "FREQUENCY-BENCHMARK";
} & BatchDataObjectBase;

export type LatencyBatchDataObject = {
    benchmarks: {
        datetime: Date;
        avg_latency: number;
        max_latency: number;
        throughput: number;
        wrk_threads: number;
        wrk_connections: number;
        wrk_rate: number;
        server_cpu: number;
        url: string;
        queues: number;
        dash?: string;
    }[];
    payload: string;
    program: "NGINX"|"Vault";
    type: "LATENCY-BENCHMARK";
} & BatchDataObjectBase;

export type BatchDataObject = ThroughputBatchDataObject|FrequencyBatchDataObject|WriteBatchDataObject|LatencyBatchDataObject;

export type RuntimeID = string;
export type RuntimeObject = {
    id: RuntimeID;
    name: string;
    color: string;
    index: number;
};

export type PlotType = "UTILIZATION"|"PARAMETER-TEST"|"CPU-ACCUMULATE"|"DURATION-BOX"|"DURATION"|"THROUGHPUT"|"THROUGHPUT-BAR"|"UTILIZATION-THROUGHPUT-MEDIAN"|"UTILIZATION-THROUGHPUT"|"UTILIZATION-THROUGHPUT-UNSORTED"|"FREQUENCY"|"UTILIZATION-AT-FREQUENCY"|"UTILIZATION-AT-FREQUENCY-BOX"|"LATENCY-THROUGHPUT";
export type PlotConfigObject = {
    type: PlotType;
    files?: string[] | string;
    xAnchorLegend?: "auto"|"center"|"left"|"right";
    yAnchorLegend?: "auto"|"middle"|"bottom"|"top";
    xLegend?: number;
    yLegend?: number;
    xRange?: [number, number];
    yRange?: [number, number];
    name?: string;
    shapes?: Partial<import("plotly.js").Shape>[];
    annotations?: Partial<import("plotly.js").Annotations>[];
    margin?: Partial<{
        r: number;
        l: number;
        t: number;
        b: number;
    }>;
    width?: number;
    height?: number;
    normalize?: boolean; // only for frequency benchmarks
};
export type PlotConfigProcessedObject = Omit<PlotConfigObject, "files"> & {
    files: [RuntimeObject, BatchDataObject][];
};

export type HardwareConfigObject = {
    cpuFrequency: number;
    cpuName: string;
}

export type PlotObject = {
    data: import("plotly.js").Data[];
    layout: import("plotly.js").Layout;
    width?: number;
    height?: number;
};

export type CustomPlotObject = {
    [name: string]: PlotObject;
};