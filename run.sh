#!/bin/bash

# VARIABLES
ROOT=$PWD
DATA_DIR=$ROOT/data
OCCLUM_DIRECTORY=/tmp/occlum_instance
GRAMINE_DIRECTORY=/tmp/gramine_instance
CONFIG_DIR=/tmp/benchmarks_config
RUNTIMES=(scone-s1)
IS_OCCLUM=false
USE_STRACE=false
PARAMETER_TEST_SSPINS=(0 10 50 100 200 400 600)
PARAMETER_TEST_SSLEEPS=(4000 4000 4000 4000 4000 4000 4000)
WRITE_BUFFER_SIZES=(1024 2048 4096 8192 65536)


# FUNCTIONS

# $1: config variable name
# $2: config value
set_config() {
    if [ "$#" -ne 2 ]; then
        echo "[ERROR]: Invalid use of set_config() in script! Expected two arguments but got $#!"
        return
    fi
    mkdir -p "$CONFIG_DIR"
    echo "$2" > $CONFIG_DIR/$1
}

# $1: dirname of benchmark routine
# $2: non-existing directory to store benchmark result in
run_benchmark() {
    echo "[INFO]: Running benchmark \"$1\"..."
    local work_dir=$PWD

    # check if there is already data for the benchmark
    if [ -d "$2" ]; then
        echo "[WARN]: There are already benchmark results for this benchmark! Overriding it..."
    fi
    mkdir -p "$2" || { echo "[ERROR]: Could not create data directory. Make sure that the directory \"$2\" does not exist already!" ; return 1 ; }

    # run for every specified runtime
    for r in ${RUNTIMES[*]}; do

        # check if file for runtime exists
        if [ ! -f "$1/$r" ]; then
            echo "[WARN]: No compiled program found in $1!"
            continue
        fi

        # prerun work depending on runtime
        if [ "$r" = "occlum" ]; then
            rm -rf $OCCLUM_DIRECTORY/stat
            set_config BM_STAT_FILES /host/stat
            set_config BM_DATA_FILEPATH /host/benchmark.json
        elif [ "$r" = "gramine" ]; then
            rm -f /tmp/stat
            set_config BM_STAT_FILES /tmp/stat
            set_config BM_DATA_FILEPATH /tmp/benchmark.json
            rm -rf $GRAMINE_DIRECTORY
            mkdir $GRAMINE_DIRECTORY
            cp $ROOT/programs/gramine-ressources/main.manifest.template $GRAMINE_DIRECTORY/ # copy gramine manifest
            cp $ROOT/programs/gramine-ressources/enclave-key.pem $GRAMINE_DIRECTORY/ # copy private key for signing
            cp $ROOT/programs/gramine-ressources/Makefile $GRAMINE_DIRECTORY/ # copy Makefile
            cp $1/linux $GRAMINE_DIRECTORY/main # copy compiled linux benchmark
            cd $GRAMINE_DIRECTORY && make clean > /dev/null && make SGX=1 > /tmp/gramine-build.log && cd $work_dir # make manifest and token (signs stuff, calcs MRSIGNER, ...)
        else
            set_config BM_STAT_FILES /proc/self/stat
            set_config BM_DATA_FILEPATH $2/$r.json
        fi
        
        # run
        echo "[INFO]: Running on $r..."

        # get the process ID and link its stat file(s)
        if [ "$r" = "occlum" ]; then
            ./$1/$r &
            sleep 3 # occlum takes a while to start its processes
            rm -rf /tmp/stat
            mkdir /tmp/stat
            [ "$USE_STRACE" = "true" ] && pid=$(pgrep occlum-run) && sudo strace -c -f -p $pid &
            for pid in $(pgrep occlum); do
                ln -s /proc/$pid/stat /tmp/stat/$pid
                echo "[INFO]: Using PID $pid to get the CPU time"
            done
            mv /tmp/stat $OCCLUM_DIRECTORY/stat
            wait
        elif [ "$r" = "gramine" ]; then
            ./$1/$r &
            sleep 1
            pid=$(pgrep loader)
            if [ -z "$pid" ]; then
                echo "[WARN]: Could not get PID of process!"
                continue
            fi
            echo "[INFO]: Using PID $pid to get the CPU time"
            [ "$USE_STRACE" = "true" ] && sudo strace -c -f -p $pid &
            ln -s /proc/$pid/stat /tmp/stat
            wait
        else
            if [ "$USE_STRACE" = "true" ]; then
                sudo strace -c -f $1/$r
            elif [ "$r" = "scone-s1" ] && [ "$SCONE_PERFORMANCE_MODE" = "all" ]; then
                for m in performance balanced eco; do
                    export SCONE_PERFORMANCE_MODE=$m
                    echo "[INFO]: Running in $m mode"
                    ./$1/$r
                    mv $2/$r.json $2/$m.$r.json
                done
            else
                ./$1/$r
                if [ "$r" = "scone-s1" ]; then
                    mv $2/$r.json $2/$SCONE_PERFORMANCE_MODE.$r.json;
                fi
            fi
        fi

        # move benchmark file if it is located elsewhere depending on runtime
        if [ "$r" = "occlum" ]; then
            mv $OCCLUM_DIRECTORY/benchmark.json $2/$r.json;
        elif [ "$r" = "gramine" ]; then
            mv /tmp/benchmark.json $2/$r.json;
        fi
        
    done
}




# BENCHMARK CONFIG
set_config BM_NUM_EXECUTIONS 100000
set_config BM_NUM_BATCHES 100
set_config BM_NUM_SAMPLES 100
set_config BM_NUM_THREADS 8
set_config BM_MIN_FREQUENCY 2
set_config BM_MAX_FREQUENCY 1000000
set_config BM_BUFFER_SIZE 4096
set_config BM_STAT_FILES /proc/self/stat

export SCONE_QUEUES=1 \
       SCONE_ETHREADS=1 \
       SCONE_PERFORMANCE_MODE=all \
       SCONE_SLOTS=256 \
       SCONE_SSPINS=100 \
       SCONE_SSLEEP=4000 \
       SCONE_ETHREAD_SLEEP_TIME_MSEC=250 \
       SCONE_LOG=debug



# START OF SCRIPT

# create data directory
if [ ! -d "$DATA_DIR" ]; then mkdir -p "$DATA_DIR"; fi
cd $ROOT/programs/benchmark-routines

# check if we should run the parameter test benchmarks
if [ "$1" = "parameter-test" ]; then

    if [ ${#PARAMETER_TEST_SSPINS[@]} -ne ${#PARAMETER_TEST_SSLEEPS[@]} ]; then
        echo "[ERROR]: The SSPINS and SSLEEPS parameter arrays must be of the same size!"
        exit 1
    fi
    echo "[INFO]: Running parameter test benchmarks on SCONE. This will take around $((${#PARAMETER_TEST_SSPINS[@]} * 100 / 60 )) minutes"

    # set variables
    #export SCONE_QUEUES=1
    RUNTIMES=(scone)

    # create parent directory
    DATA_DIR=$DATA_DIR/parameter-test
    mkdir -p "$DATA_DIR" || { echo "[ERROR]: Could not create data directory. Make sure that the directory \"$DATA_DIR\" does not exist already!" ; exit 1 ; }

    # loop over parameters
    for (( i=0; i<${#PARAMETER_TEST_SSPINS[@]}; i++ )) ; do
        export SCONE_SSPINS=${PARAMETER_TEST_SSPINS[$i]}
        export SCONE_SSLEEP=${PARAMETER_TEST_SSLEEPS[$i]}
        run_benchmark write-variable-throughput $DATA_DIR/param-test-$(($i+1))
    done

else

    # check if we're running in an occlum container
    if [ -x "$(command -v occlum-g++)" ]; then
        echo "[INFO]: Running benchmarks on Occlum only!"
        RUNTIMES=(occlum)
        IS_OCCLUM=true
    fi

    # check if gramine is installed
    if [ -x "$(command -v gramine-direct)" ]; then
        printf ""
        #RUNTIMES+=(gramine)
    else
        echo "[WARN]: Gramine is not installed!"
    fi

    # make sure that we have root access for strace
    [ "$USE_STRACE" = "true" ] && sudo echo "[INFO]: Checking root access..."

    # execute each benchmark routine
    for d in */ ; do

        # remove trailing "/" from directory name
        d=${d::-1}

        # check if we should run only one specific benchmark
        if [[ $# -ge 1 && "$1" != "$d" ]]; then continue; fi

        # run it
        if [ "$d" = "write" ]; then
            for b in "${WRITE_BUFFER_SIZES[@]}"; do
                echo "[INFO]: Using buffer size $b..."
                set_config BM_BUFFER_SIZE $b
                run_benchmark $d $DATA_DIR/$d/$b
            done
        else
            run_benchmark $d $DATA_DIR/$d
        fi

    done

fi
