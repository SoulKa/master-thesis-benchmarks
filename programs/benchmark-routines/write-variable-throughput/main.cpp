#include "../../bench-tools/benchmark.h"

#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>

int main( int argc, char **argv, char **envp ) {

    FrequencyBatch batch; // a whole batch of benchmarks
    FrequencyBenchmark benchmark; // a single benchmark
    std::string data_filepath; // the file to write the results into
    std::string stat_filepath; // the file(s) containing the CPU times
    benchmark.m_pFunction = (void_func_t)WriteBenchmark::write_single_thread;
    benchmark.m_uBufferSize = 1;

    // check environment variables
    process_environment_variables(&data_filepath);
    Benchmark::process_environment_variables(nullptr, nullptr, &stat_filepath);
    FrequencyBatch::process_environment_variables(&batch.m_uNumSamples, &batch.m_dMinFrequency, &batch.m_dMaxFrequency);
    FrequencyBenchmark::process_environment_variables(&benchmark.m_uNumExecutions, &benchmark.m_uNumThreads);
    if (data_filepath.empty()) LOG_WARN("No filepath for the benchmark results specified!\n");
    LOG_INFO("Running benchmark from target frequency %.0fHz to %.0fHz...\n", batch.m_dMinFrequency, batch.m_dMaxFrequency );
    
    // do benchmark
    if (!Benchmark::get_stat_files(stat_filepath.c_str())) return 1;;
    benchmark.open_tmp_files();
    batch.run(benchmark);
    benchmark.close_tmp_files();

    // store result
    if (data_filepath.empty()) {
        batch.to_json(stdout);
    } else {
        batch.to_json(data_filepath.c_str(), environment_variables_to_json_array(envp).c_str());
    }
    
    // done
    return 0;

}