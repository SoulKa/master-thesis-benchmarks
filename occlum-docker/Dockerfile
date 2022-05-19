FROM occlum/occlum:0.26.1-ubuntu18.04

ARG BENCHMARKS_DIR=/root/benchmarks

# copy benchmark source so it can be built with the occlum toolchain
RUN mkdir $BENCHMARKS_DIR
COPY programs $BENCHMARKS_DIR/programs
COPY build.sh $BENCHMARKS_DIR/
COPY run.sh $BENCHMARKS_DIR/
RUN mkdir $BENCHMARKS_DIR/occlum-docker
COPY occlum-docker/Occlum.json $BENCHMARKS_DIR/occlum-docker/
