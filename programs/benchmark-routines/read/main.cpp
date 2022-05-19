#include "../../bench-tools/benchmark.h"

#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>

int fd;
char buf[] = "This is a benchmark file, please ignore me!\n";

void bench_func() {
    if (pread(fd, &buf, 1, 0) == -1) {
        LOG_ERROR("Could not read file! Error %d: %s\n", errno, strerror(errno));
        return;
    }
    if (buf[0] != 'T') {
        LOG_WARN("Buffer did not match the content of the file!\n");
    }
}

int main( int argc, char **argv, char **envp ) {

    Batch batch; // a whole batch of benchmarks
    Benchmark benchmark; // a single benchmark
    std::string data_filepath; // the file to write the results into
    std::string stat_filepath; // the file(s) containing the CPU times
    benchmark.m_pFunction = (void_func_t)bench_func;

    // check environment variables
    process_environment_variables(&data_filepath);
    Batch::process_environment_variables(&batch.m_uNumBatches);
    Benchmark::process_environment_variables(&benchmark.m_uNumExecutions, &benchmark.m_uNumThreads, &stat_filepath);
    if (data_filepath.empty()) LOG_WARN("No filepath for the benchmark results specified!\n");
    LOG_INFO("Running benchmark %u times in %u batches and %u thread%s...\n", benchmark.m_uNumExecutions, batch.m_uNumBatches, benchmark.m_uNumThreads, benchmark.m_uNumThreads == 1 ? "" : "s");

    // open temp file
    fd = open("/tmp/read-benchmark.txt", O_RDWR|O_CREAT, S_IRUSR|S_IWUSR|S_IRGRP|S_IWGRP|S_IROTH|S_IWOTH);
    unlink("/tmp/read-benchmark.txt");
    if (write(fd, buf, sizeof(buf)) != sizeof(buf)) {
        LOG_ERROR("Could not write to file! Error %d: %s\n", errno, strerror(errno));
        close(fd);
        return 1;
    }
    fsync(fd);

    // do benchmark
    if (!Benchmark::get_stat_files(stat_filepath.c_str())) return 1;
    batch.run(benchmark);
    close(fd);
    

    // store result
    if (data_filepath.empty()) {
        batch.to_json(stdout);
    } else {
        batch.to_json(data_filepath.c_str(), environment_variables_to_json_array(envp).c_str());
    }

    // done
    return 0;

}