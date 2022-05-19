#include "../../bench-tools/benchmark.h"

#include <errno.h>
#include <stdio.h>
#include <unistd.h>

int main( int argc, char **argv, char **envp ) {

    Batch batch; // a whole batch of benchmarks
    WriteBenchmark benchmark; // a single benchmark
    std::string data_filepath; // the file to write the results into
    std::string stat_filepath; // the file(s) containing the CPU times
    benchmark.m_pFunction = (void_func_t)WriteBenchmark::write_single_thread;
    
    // check environment variables
    process_environment_variables(&data_filepath);
    Batch::process_environment_variables(&batch.m_uNumBatches);
    Benchmark::process_environment_variables(nullptr, nullptr, &stat_filepath);
    WriteBenchmark::process_environment_variables(&benchmark.m_uNumExecutions, &benchmark.m_uNumThreads, &benchmark.m_uBufferSize);
    if (data_filepath.empty()) LOG_WARN("No filepath for the benchmark results specified!\n");
    LOG_INFO("Running benchmark %u times in %u batches and %u thread%s with buffer size %lu...\n", benchmark.m_uNumExecutions, batch.m_uNumBatches, benchmark.m_uNumThreads, benchmark.m_uNumThreads == 1 ? "" : "s", benchmark.m_uBufferSize);

    // do benchmark
    if (!Benchmark::get_stat_files(stat_filepath.c_str())) return 1;;
    benchmark.open_tmp_files();
    batch.run(benchmark);
    benchmark.close_tmp_files();

    // store result
    if (!data_filepath.empty()) batch.to_json(data_filepath.c_str(), (environment_variables_to_json_array(envp) + ",\n    \"bufferSize\": " + std::to_string(benchmark.m_uBufferSize)).c_str());
    
    // done
    return 0;

}