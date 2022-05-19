# Micro Benchmarks

This directory contains all microbenchmarks related files.

## Contents

- `/bench-tools`: The shared C++ code for the microbenchmarks
- `/benchmark-routines`: Individual C++ code that utilizes the shared benchmarking tools
- `/gramine-ressources`: Files needed to build and run applications in Gramine
- `/mutex-overhead`: A little benchmarking program to measure the latency for conescutive multi-threaded mutex locks
- `/strace-parser`: A small NodeJS to process data I extracted with `strace`