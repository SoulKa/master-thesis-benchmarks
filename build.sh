#!/bin/bash

ROOT=$PWD
DATA_DIR=$ROOT/data
ARGS="-Wall -pthread -O2"
INCLUDES=$ROOT/programs/bench-tools/benchmark.cpp
IS_OCCLUM=false
OCCLUM_DIRECTORY=/tmp/occlum_instance
GRAMINE_DIRECTORY=/tmp/gramine_instance
CONFIG_DIRECTORY=/tmp/benchmarks_config

# check if we're running in an occlum container
if [ -x "$(command -v occlum-g++)" ]; then
    echo "[INFO]: Compiling with occlum-g++ only!"
    IS_OCCLUM=true

    # create new Occlum instance
    rm -rf $OCCLUM_DIRECTORY
    occlum new $OCCLUM_DIRECTORY
    cp $ROOT/occlum-docker/Occlum.json $OCCLUM_DIRECTORY
fi

# create config directory
mkdir -p $CONFIG_DIRECTORY
cd $ROOT/programs/benchmark-routines

# build binaries
for d in */ ; do
    d=${d::-1}          # remove trailing "/"
    MAIN_C=$d/main.cpp  # main file to compile

    # check if we should compile only one specific benchmark
    if [[ $# -ge 1 && "$1" != "$d" ]]; then continue; fi

    # check if file exists and compile with scone-gcc
    if [ -f "$MAIN_C" ]; then
        echo "[INFO]: Compiling $d..."
        if [ "$IS_OCCLUM" = "true" ]; then
            occlum-g++ $ARGS -o $OCCLUM_DIRECTORY/image/bin/$d $INCLUDES $MAIN_C
            printf "#!/bin/sh\n" > $d/occlum
            printf "set -e\n" >> $d/occlum
            printf "cd $OCCLUM_DIRECTORY\n" >> $d/occlum
            printf "cp -R $CONFIG_DIRECTORY $OCCLUM_DIRECTORY/image/tmp/\n" >> $d/occlum
            printf "occlum build\n" >> $d/occlum
            printf "occlum run /bin/$d\n" >> $d/occlum
            printf "cd $ROOT\n" >> $d/occlum
            chmod +x $d/occlum
        else

            # compile for Linux
            g++ $ARGS -o $d/linux $INCLUDES $MAIN_C

            # compile for SCONE
            scone-g++ $ARGS -o $d/scone-s1 $INCLUDES $MAIN_C
            scone5-g++ $ARGS -o $d/scone $INCLUDES $MAIN_C

            # create runscript for Gramine
            printf "#!/bin/sh\n" > $d/gramine
            printf "set -e\n" >> $d/gramine
            printf "cd $GRAMINE_DIRECTORY\n" >> $d/gramine
            printf "gramine-sgx main 2>/tmp/gramine-benchmark.log\n" >> $d/gramine
            printf "cd $ROOT\n" >> $d/gramine
            chmod +x $d/gramine

        fi
    else
        echo "[WARN]: No \"main.c\" found in $d!"
    fi
done
