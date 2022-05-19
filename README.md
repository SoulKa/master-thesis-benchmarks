# Source Code for Tools and Microbenchmarks

This repository contains all microbenchmark routines used for my master thesis. The plotter and tools for Occlum and Gramine are also included. Note that these files are originially intended for my personal use only and I worked only on a single remote machine. Some bash scripts require fixed filepaths. If you need to use them, you must change these paths accordingly and install al dependencies.

## Content of this Repository

- `/occlum-docker`: Files needed to build the current Occlum docker container. Run `./build.sh` to build the container and `./run.sh` to start an interactive bash shell in the docker environment. The build script also copies the microbenchmarks into the container. You can build the benchmarks in the container, the script will recognize that you are inside an Occlum container.
- `/plotter`: The NodeJS script(s) I used to create my benchmarking plots using PlotlyJS. The script is pretty messy and was not intended for publication. Plots are saved in `/plots/...`
- `/programs`: All files related to the **microbenchmarks**. For further information see the [readme](/programs/README.md).
- `/build.sh`: Synopsis `./build.sh [benchmark-name]`. Builds one or all microbenchmark for Linux, Gramine, SCONE, modified SCONE, and Occlum
- `/run.sh`: Synopsis `./run.sh [benchmark-name]`. Runs one or all microbenchmarks for Linux, Gramine, SCONE, and modified SCONE. The script has many environment variables that can be modified to change the RTEs to run the benchmark in, lower, and upper system call workload, the number of threads, the number of samples, etc. Benchmark results are saved in `/data/...`